"""
Shared Knowledge API — manages the global knowledge library available to all users.

- Any authenticated user can read shared courses and documents.
- Any authenticated user can upload documents to a shared course.
- Only admin users can create / delete shared courses and delete shared documents.
"""
import hashlib
import os
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.models.models import SharedCourse, SharedDocument, User
from app.schemas.schemas import SharedCourseCreate, SharedCourseOut, SharedDocumentOut
from app.api.deps import get_current_user, get_admin_user
from app.services.shared_document_processor import process_shared_document

router = APIRouter(prefix="/api/shared-knowledge", tags=["shared-knowledge"])


async def _process_in_new_session(document_id: str) -> None:
    """Run shared document processing in its own DB session (background task safe)."""
    async with AsyncSessionLocal() as db:
        try:
            await process_shared_document(document_id, db)
        except Exception:
            pass


# ── Shared Courses ────────────────────────────────────────────────────────────

@router.get("/courses", response_model=List[SharedCourseOut])
async def list_shared_courses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SharedCourse).order_by(SharedCourse.created_at.desc())
    )
    return result.scalars().all()


@router.post("/courses", response_model=SharedCourseOut, status_code=201)
async def create_shared_course(
    data: SharedCourseCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    course = SharedCourse(
        name=data.name,
        description=data.description,
        color=data.color,
        created_by=admin.id,
    )
    db.add(course)
    await db.flush()
    await db.refresh(course)
    await db.commit()
    return course


@router.delete("/courses/{course_id}", status_code=204)
async def delete_shared_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(SharedCourse).where(SharedCourse.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Shared course not found")
    await db.delete(course)
    await db.commit()


# ── Shared Documents ──────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/documents", response_model=List[SharedDocumentOut])
async def list_shared_documents(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SharedDocument)
        .where(SharedDocument.shared_course_id == course_id)
        .order_by(SharedDocument.created_at.desc())
    )
    return result.scalars().all()


@router.post("/courses/{course_id}/documents", response_model=SharedDocumentOut, status_code=201)
async def upload_shared_document(
    course_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SharedCourse).where(SharedCourse.id == course_id))
    shared_course = result.scalar_one_or_none()
    if not shared_course:
        raise HTTPException(404, "Shared course not found")

    content = await file.read()

    # Duplicate detection by hash within the shared course
    content_hash = hashlib.sha256(content).hexdigest()
    dup_result = await db.execute(
        select(SharedDocument).where(
            SharedDocument.shared_course_id == course_id,
            SharedDocument.content_hash == content_hash,
        )
    )
    if dup_result.scalar_one_or_none():
        raise HTTPException(409, detail={"duplicate": True, "name": file.filename})

    upload_dir = Path(settings.upload_dir) / "shared"
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "file.pdf").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_dir / stored_name

    with open(file_path, "wb") as f:
        f.write(content)

    doc = SharedDocument(
        shared_course_id=course_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        file_path=str(file_path),
        processing_status="pending",
        content_hash=content_hash,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    background_tasks.add_task(_process_in_new_session, doc.id)

    await db.commit()
    return doc


@router.delete("/courses/{course_id}/documents/{doc_id}", status_code=204)
async def delete_shared_document(
    course_id: str,
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(SharedDocument).where(
            SharedDocument.id == doc_id,
            SharedDocument.shared_course_id == course_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Shared document not found")
    try:
        os.remove(doc.file_path)
    except FileNotFoundError:
        pass
    await db.delete(doc)
    await db.commit()
