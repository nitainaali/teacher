import hashlib
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import Document
from app.schemas.schemas import DocumentOut
from app.services.document_processor import process_document
from typing import List, Optional

router = APIRouter(prefix="/api/documents", tags=["documents"])


async def _process_in_new_session(document_id: str) -> None:
    """Run document processing with its own DB session (background task safe)."""
    async with AsyncSessionLocal() as db:
        try:
            await process_document(document_id, db)
        except Exception:
            pass


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    course_id: str = Form(...),
    doc_type: str = Form("lecture"),
    db: AsyncSession = Depends(get_db),
):
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()

    # Duplicate detection: check SHA-256 hash first
    content_hash = hashlib.sha256(content).hexdigest()
    dup_result = await db.execute(
        select(Document).where(
            Document.course_id == course_id,
            Document.content_hash == content_hash,
        )
    )
    dup = dup_result.scalar_one_or_none()
    if dup:
        raise HTTPException(
            status_code=409,
            detail={"duplicate": True, "name": dup.original_name},
        )

    # Fallback: check by filename (catches pre-migration files with NULL hash)
    if file.filename:
        dup_name_result = await db.execute(
            select(Document).where(
                Document.course_id == course_id,
                Document.original_name == file.filename,
            )
        )
        dup_name = dup_name_result.scalar_one_or_none()
        if dup_name:
            raise HTTPException(
                status_code=409,
                detail={"duplicate": True, "name": dup_name.original_name},
            )

    ext = Path(file.filename or "file.pdf").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_dir / stored_name

    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        course_id=course_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        doc_type=doc_type,
        file_path=str(file_path),
        processing_status="pending",
        content_hash=content_hash,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    background_tasks.add_task(_process_in_new_session, doc.id)

    return doc


@router.get("/", response_model=List[DocumentOut])
async def list_documents(
    course_id: Optional[str] = None,
    upload_source: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Document).order_by(Document.created_at.desc())
    if course_id:
        query = query.where(Document.course_id == course_id)
    if upload_source:
        query = query.where(Document.upload_source == upload_source)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentOut)
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    try:
        os.remove(doc.file_path)
    except FileNotFoundError:
        pass
    await db.delete(doc)
    await db.commit()
