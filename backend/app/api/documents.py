import hashlib
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import Document, Course, SharedDocument, User
from app.schemas.schemas import DocumentOut, DocumentUpdate, ImportFromSharedRequest
from app.services.document_processor import process_document
from app.api.deps import get_current_user
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
):
    query = select(Document).order_by(Document.created_at.desc())
    if course_id:
        query = query.where(Document.course_id == course_id)
    if upload_source:
        query = query.where(Document.upload_source == upload_source)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentOut)
async def get_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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


@router.patch("/{doc_id}", response_model=DocumentOut)
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename a personal document or change its doc_type."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if body.original_name is not None:
        doc.original_name = body.original_name
    if body.doc_type is not None:
        doc.doc_type = body.doc_type
    await db.flush()
    await db.refresh(doc)
    return doc


@router.post("/{doc_id}/retry", response_model=DocumentOut)
async def retry_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retry processing for a failed or stuck personal document."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    doc.processing_status = "pending"
    doc.metadata_ = None
    await db.flush()
    await db.refresh(doc)
    background_tasks.add_task(_process_in_new_session, doc.id)
    return doc


@router.post("/import-from-shared", response_model=DocumentOut, status_code=201)
async def import_from_shared(
    body: ImportFromSharedRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy a shared-library document into the user's personal course knowledge."""
    # Verify shared document exists
    sd_result = await db.execute(select(SharedDocument).where(SharedDocument.id == body.shared_document_id))
    shared_doc = sd_result.scalar_one_or_none()
    if not shared_doc:
        raise HTTPException(404, "Shared document not found")

    # Verify the target course belongs to current_user
    course_result = await db.execute(
        select(Course).where(Course.id == body.course_id, Course.user_id == current_user.id)
    )
    if not course_result.scalar_one_or_none():
        raise HTTPException(404, "Course not found or not owned by you")

    # Read source file
    try:
        with open(shared_doc.file_path, "rb") as f:
            content = f.read()
    except FileNotFoundError:
        raise HTTPException(404, "Source file not found on disk")

    # Duplicate detection within the target course
    content_hash = hashlib.sha256(content).hexdigest()
    dup_result = await db.execute(
        select(Document).where(
            Document.course_id == body.course_id,
            Document.content_hash == content_hash,
        )
    )
    if dup_result.scalar_one_or_none():
        raise HTTPException(409, detail={"duplicate": True, "name": shared_doc.original_name})

    # Copy file to personal upload storage
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(shared_doc.filename).suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_dir / stored_name
    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        course_id=body.course_id,
        filename=stored_name,
        original_name=shared_doc.original_name,
        doc_type=shared_doc.doc_type,
        file_path=str(file_path),
        processing_status="pending",
        content_hash=content_hash,
        upload_source="knowledge",
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    background_tasks.add_task(_process_in_new_session, doc.id)

    await db.commit()
    return doc
