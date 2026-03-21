from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import StudentProfile, User
from app.schemas.schemas import StudentProfileUpsert, StudentProfileOut
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("/", response_model=StudentProfileOut)
async def get_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(user_id=current_user.id)
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
    return profile


@router.put("/", response_model=StudentProfileOut)
async def upsert_profile(
    data: StudentProfileUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(user_id=current_user.id)
        db.add(profile)

    for k, v in data.model_dump(exclude_none=True).items():
        setattr(profile, k, v)

    await db.flush()
    await db.refresh(profile)
    return profile
