from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
import uuid, os
from pathlib import Path

from app.core.config import settings
from app.core.database import get_db
from app.models.models import ExamUpload, Document
from app.schemas.schemas import ExamUploadOut

router = APIRouter(prefix="/api/exams", tags=["exams"])


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
    return exam


@router.post("/{exam_id}/analyze", response_model=ExamUploadOut)
async def analyze_exam(exam_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExamUpload).where(ExamUpload.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(404, "Exam not found")
    # Stub — full analysis in Phase 2
    exam.analysis = {"status": "analysis_not_implemented"}
    await db.flush()
    await db.refresh(exam)
    return exam


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
