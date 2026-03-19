import base64
import uuid
from pathlib import Path
from typing import List, Optional, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import ExamUpload, Document, ExamAnalysisRecord
from app.schemas.schemas import ExamUploadOut, ExamAnalysisRecordOut
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


async def _save_analysis_record(
    record_id: str,
    course_id: Optional[str],
    reference_exam_name: Optional[str],
    student_exam_name: Optional[str],
    analysis_result: str,
):
    """Save exam analysis in a new DB session (called after streaming)."""
    async with AsyncSessionLocal() as db:
        record = ExamAnalysisRecord(
            id=record_id,
            course_id=course_id,
            reference_exam_name=reference_exam_name,
            student_exam_name=student_exam_name,
            analysis_result=analysis_result,
        )
        db.add(record)
        await db.commit()


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
        upload_source="exam_upload",
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
    background_tasks: BackgroundTasks,
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

    exam_images = _file_to_base64_images(doc.file_path)[:10]
    if not exam_images:
        raise HTTPException(400, "Could not read exam file. Ensure it is a valid PDF or image.")

    # Optionally load reference exam
    reference_images = None
    reference_name: Optional[str] = None
    ref_id = reference_exam_id or exam.reference_exam_id
    if ref_id:
        ref_result = await db.execute(select(ExamUpload).where(ExamUpload.id == ref_id))
        ref_exam = ref_result.scalar_one_or_none()
        if ref_exam:
            ref_doc_result = await db.execute(select(Document).where(Document.id == ref_exam.document_id))
            ref_doc = ref_doc_result.scalar_one_or_none()
            if ref_doc:
                reference_images = _file_to_base64_images(ref_doc.file_path)[:10]
                reference_name = ref_doc.original_name

    student_exam_name = doc.original_name
    course_id = exam.course_id

    # Pre-generate record ID so frontend can reference it via SSE marker
    record_id = str(uuid.uuid4())

    async def event_generator():
        collected: list[str] = []
        success = False
        try:
            async for chunk in analyze_exam_stream(
                db=db,
                exam_images_b64=exam_images,
                course_id=course_id,
                reference_images_b64=reference_images,
                guidance=guidance,
                student_experience=student_experience,
                language=language,
            ):
                collected.append(chunk)
                yield f"data: {chunk}\n\n"
            success = True
        except Exception as e:
            yield f"data: [ERROR: {str(e)[:100]}]\n\n"
        finally:
            if success:
                yield f"data: [RECORD_ID:{record_id}]\n\n"
            yield "data: [DONE]\n\n"

        # Save analysis record after streaming completes (normal path only)
        if success:
            full_result = "".join(collected)
            if full_result.strip():
                background_tasks.add_task(
                    _save_analysis_record, record_id, course_id, reference_name, student_exam_name, full_result
                )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/analyses", response_model=List[ExamAnalysisRecordOut])
async def list_exam_analyses(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(ExamAnalysisRecord).order_by(ExamAnalysisRecord.created_at.desc())
    if course_id:
        query = query.where(ExamAnalysisRecord.course_id == course_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/analyses/{record_id}", response_model=ExamAnalysisRecordOut)
async def get_exam_analysis(record_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExamAnalysisRecord).where(ExamAnalysisRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Analysis record not found")
    return record


@router.patch("/analyses/{record_id}", response_model=ExamAnalysisRecordOut)
async def update_exam_analysis(
    record_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExamAnalysisRecord).where(ExamAnalysisRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Analysis record not found")
    if "chat_session_id" in body:
        record.chat_session_id = body["chat_session_id"]
    await db.commit()
    await db.refresh(record)
    return record


@router.delete("/analyses/{record_id}", status_code=204)
async def delete_exam_analysis(record_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExamAnalysisRecord).where(ExamAnalysisRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Analysis record not found")
    await db.delete(record)
    await db.commit()


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
