from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid
from pathlib import Path

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import Document
from app.schemas.schemas import DocumentOut
from app.services.document_processor import process_document


async def _process_in_new_session(document_id: str) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await process_document(document_id, db)
        except Exception:
            pass

router = APIRouter(prefix="/api/transcripts", tags=["transcripts"])


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_transcript(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    course_id: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "transcript.pdf").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_dir / stored_name
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        course_id=course_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        doc_type="transcript",
        file_path=str(file_path),
        processing_status="pending",
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    background_tasks.add_task(_process_in_new_session, doc.id)
    return doc


@router.post("/{doc_id}/summarize")
async def summarize_transcript(doc_id: str, db: AsyncSession = Depends(get_db)):
    # Stub — Phase 1 scaffold
    return {"status": "not_implemented", "doc_id": doc_id}
