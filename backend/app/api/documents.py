import hashlib
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import Document, Course, SharedDocument, User
from app.schemas.schemas import DocumentOut, DocumentUpdate, ImportFromSharedRequest
from app.services.document_processor import process_document
from app.api.deps import get_current_user, get_admin_user
from typing import List, Optional

router = APIRouter(prefix="/api/documents", tags=["documents"])


async def _get_doc_owned(doc_id: str, user_id: str, db: AsyncSession) -> Document:
    """Fetch a document and verify it belongs to the current user via Course. Raises 404 otherwise."""
    result = await db.execute(
        select(Document)
        .join(Course, Document.course_id == Course.id)
        .where(Document.id == doc_id, Course.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


async def _process_in_new_session(document_id: str) -> None:
    """Run document processing with its own DB session (background task safe)."""
    async with AsyncSessionLocal() as db:
        try:
            await process_document(document_id, db)
        except Exception as e:
            print(f"[document processor] error processing {document_id}: {e}")


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    course_id: str = Form(...),
    doc_type: str = Form("lecture"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify course ownership
    course_check = await db.execute(
        select(Course).where(Course.id == course_id, Course.user_id == current_user.id)
    )
    if not course_check.scalar_one_or_none():
        raise HTTPException(404, "Course not found")

    allowed_types = {"application/pdf", "image/png", "image/jpeg", "image/jpg"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: PDF, PNG, JPEG.",
        )

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
        upload_source="knowledge",
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
    # Always scope to the current user's courses via a JOIN
    query = (
        select(Document)
        .join(Course, Document.course_id == Course.id)
        .where(Course.user_id == current_user.id)
        .order_by(Document.created_at.desc())
    )
    if course_id:
        query = query.where(Document.course_id == course_id)
    if upload_source:
        if upload_source == "knowledge":
            # Include rows with NULL upload_source — these are documents created before the
            # column was added (or before the ORM default fired) and are conceptually "knowledge" docs.
            query = query.where(
                or_(Document.upload_source == "knowledge", Document.upload_source == None)
            )
        else:
            query = query.where(Document.upload_source == upload_source)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentOut)
async def get_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_doc_owned(doc_id, current_user.id, db)


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = await _get_doc_owned(doc_id, current_user.id, db)
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
    doc = await _get_doc_owned(doc_id, current_user.id, db)
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
    doc = await _get_doc_owned(doc_id, current_user.id, db)
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

    # Read source file — catch all OS errors, not just FileNotFoundError
    try:
        with open(shared_doc.file_path, "rb") as f:
            content = f.read()
    except FileNotFoundError:
        raise HTTPException(404, "Source file not found on disk")
    except OSError as e:
        print(f"[import-from-shared] cannot read {shared_doc.file_path}: {type(e).__name__}: {e}")
        raise HTTPException(500, "Cannot read source file")

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
    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except OSError as e:
        print(f"[import-from-shared] cannot write {file_path}: {type(e).__name__}: {e}")
        raise HTTPException(500, "Cannot write file to storage")

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


@router.delete("/by-course/{course_id}", status_code=204)
async def delete_all_course_documents(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete ALL personal documents in a course the current user owns (files + DB records)."""
    result = await db.execute(
        select(Document)
        .join(Course, Document.course_id == Course.id)
        .where(
            Document.course_id == course_id,
            Course.user_id == current_user.id,
        )
    )
    docs = result.scalars().all()
    for doc in docs:
        try:
            os.remove(doc.file_path)
        except FileNotFoundError:
            pass
        await db.delete(doc)
    await db.commit()
