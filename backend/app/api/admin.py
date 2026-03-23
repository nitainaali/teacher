"""Admin utilities — storage management, orphan cleanup."""
import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Document, SharedDocument, User
from app.api.deps import get_admin_user

router = APIRouter(prefix="/api/admin", tags=["admin"])


class StorageStats(BaseModel):
    upload_dir: str
    total_files: int
    total_size_mb: float
    personal_files: int
    personal_size_mb: float
    shared_files: int
    shared_size_mb: float
    orphaned_personal: int
    orphaned_personal_size_mb: float
    orphaned_shared: int
    orphaned_shared_size_mb: float


class CleanupResult(BaseModel):
    deleted_files: int
    freed_mb: float
    errors: List[str]


def _scan_dir(directory: Path) -> dict[str, int]:
    """Return {filename: size_bytes} for all files directly in directory (non-recursive)."""
    result = {}
    if not directory.exists():
        return result
    for entry in directory.iterdir():
        if entry.is_file():
            result[entry.name] = entry.stat().st_size
    return result


@router.get("/storage", response_model=StorageStats)
async def get_storage_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Return disk usage stats and orphaned file counts."""
    upload_dir = Path(settings.upload_dir)
    shared_dir = upload_dir / "shared"

    # Scan disk
    personal_on_disk = _scan_dir(upload_dir)   # {filename: bytes}
    shared_on_disk = _scan_dir(shared_dir)

    # Fetch DB filenames
    personal_db = set(
        row[0] for row in (await db.execute(select(Document.filename))).all()
    )
    shared_db = set(
        row[0] for row in (await db.execute(select(SharedDocument.filename))).all()
    )

    # Compute orphans
    orphaned_personal = {f: s for f, s in personal_on_disk.items() if f not in personal_db}
    orphaned_shared = {f: s for f, s in shared_on_disk.items() if f not in shared_db}

    def mb(size_dict: dict) -> float:
        return round(sum(size_dict.values()) / 1_048_576, 2)

    return StorageStats(
        upload_dir=str(upload_dir),
        total_files=len(personal_on_disk) + len(shared_on_disk),
        total_size_mb=mb({**personal_on_disk, **shared_on_disk}),
        personal_files=len(personal_on_disk),
        personal_size_mb=mb(personal_on_disk),
        shared_files=len(shared_on_disk),
        shared_size_mb=mb(shared_on_disk),
        orphaned_personal=len(orphaned_personal),
        orphaned_personal_size_mb=mb(orphaned_personal),
        orphaned_shared=len(orphaned_shared),
        orphaned_shared_size_mb=mb(orphaned_shared),
    )


@router.post("/cleanup-storage", response_model=CleanupResult)
async def cleanup_orphaned_files(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Delete files on disk that have no matching DB record. Admin only."""
    upload_dir = Path(settings.upload_dir)
    shared_dir = upload_dir / "shared"

    personal_on_disk = _scan_dir(upload_dir)
    shared_on_disk = _scan_dir(shared_dir)

    personal_db = set(
        row[0] for row in (await db.execute(select(Document.filename))).all()
    )
    shared_db = set(
        row[0] for row in (await db.execute(select(SharedDocument.filename))).all()
    )

    deleted = 0
    freed_bytes = 0
    errors: List[str] = []

    for filename, size in personal_on_disk.items():
        if filename not in personal_db:
            try:
                (upload_dir / filename).unlink()
                deleted += 1
                freed_bytes += size
                print(f"[admin cleanup] deleted orphan: uploads/{filename} ({size} bytes)")
            except OSError as e:
                errors.append(f"{filename}: {e}")

    for filename, size in shared_on_disk.items():
        if filename not in shared_db:
            try:
                (shared_dir / filename).unlink()
                deleted += 1
                freed_bytes += size
                print(f"[admin cleanup] deleted orphan: uploads/shared/{filename} ({size} bytes)")
            except OSError as e:
                errors.append(f"shared/{filename}: {e}")

    print(f"[admin cleanup] done — {deleted} files deleted, {freed_bytes / 1_048_576:.2f} MB freed")
    return CleanupResult(
        deleted_files=deleted,
        freed_mb=round(freed_bytes / 1_048_576, 2),
        errors=errors,
    )
