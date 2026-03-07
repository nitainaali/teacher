import base64
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.models.models import ExamUpload, Document
from app.schemas.schemas import ExamUploadOut
from app.services.exam_analyzer import analyze_exam_stream
from app.services.document_processor import _pdf_to_base64_images

router = APIRouter(prefix="/api/exams", tags=["exams"])


def _file_to_base64_images(file_path: str) -> list[str]:
    """Convert a PDF or image file to list of base64-encoded strings."""
    path = Path(file_path)
    ext = path.suffix.lower()
    if ext == ".pdf":
        return _pdf_to_base64_images(file_path)
    else:
        try:
            with open(file_path, "rb") as f:
                return [base64.b64encode(f.read()).decode()]
        except Exception:
            return []


@router.post("/upload", response_model=ExamUploadOut, status_code=201)
async def upload_exam(
    file: UploadFile = File(...),
    course_id: str = Form(...),
    exam_type: str = Form("reference"),
    reference_exam_id: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "exam.pdf").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_dir / stored_name
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        course_id=course_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        doc_type="exam",
        file_path=str(file_path),
        processing_status="done",
    )
    db.add(doc)
    await db.flush()

    exam = ExamUpload(
        course_id=course_id,
        document_id=doc.id,
        exam_type=exam_type,
        reference_exam_id=reference_exam_id,
    )
    db.add(exam)
    await db.flush()
    await db.refresh(exam)
    await db.commit()
    return exam


@router.post("/{exam_id}/analyze")
async def analyze_exam(
    exam_id: str,
    guidance: Optional[str] = Form(None),
    student_experience: Optional[str] = Form(None),
    reference_exam_id: Optional[str] = Form(None),
    language: str = Form("en"),
    db: AsyncSession = Depends(get_db),
):
    """Stream full exam analysis as SSE. Returns per-topic feedback in markdown."""
    result = await db.execute(select(ExamUpload).where(ExamUpload.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(404, "Exam not found")

    doc_result = await db.execute(select(Document).where(Document.id == exam.document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Exam document not found")

    exam_images = _file_to_base64_images(doc.file_path)[:10]  # Cap at 10 pages to avoid Claude API 413
    if not exam_images:
        raise HTTPException(400, "Could not read exam file. Ensure it is a valid PDF or image.")

    # Optionally load reference exam
    reference_images = None
    ref_id = reference_exam_id or exam.reference_exam_id
    if ref_id:
        ref_result = await db.execute(select(ExamUpload).where(ExamUpload.id == ref_id))
        ref_exam = ref_result.scalar_one_or_none()
        if ref_exam:
            ref_doc_result = await db.execute(select(Document).where(Document.id == ref_exam.document_id))
            ref_doc = ref_doc_result.scalar_one_or_none()
            if ref_doc:
                reference_images = _file_to_base64_images(ref_doc.file_path)[:10]  # Cap at 10 pages

    async def event_generator():
        try:
            async for chunk in analyze_exam_stream(
                db=db,
                exam_images_b64=exam_images,
                course_id=exam.course_id,
                reference_images_b64=reference_images,
                guidance=guidance,
                student_experience=student_experience,
                language=language,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: [ERROR: {str(e)[:100]}]\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/", response_model=List[ExamUploadOut])
async def list_exams(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(ExamUpload).order_by(ExamUpload.created_at.desc())
    if course_id:
        query = query.where(ExamUpload.course_id == course_id)
    result = await db.execute(query)
    return result.scalars().all()
