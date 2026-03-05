from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import StudentProfile
from app.schemas.schemas import StudentProfileUpsert, StudentProfileOut

router = APIRouter(prefix="/api/profile", tags=["profile"])

SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


@router.get("/", response_model=StudentProfileOut)
async def get_profile(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudentProfile).where(StudentProfile.id == SINGLETON_ID))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(id=SINGLETON_ID)
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
    return profile


@router.put("/", response_model=StudentProfileOut)
async def upsert_profile(data: StudentProfileUpsert, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudentProfile).where(StudentProfile.id == SINGLETON_ID))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(id=SINGLETON_ID)
        db.add(profile)

    for k, v in data.model_dump(exclude_none=True).items():
        setattr(profile, k, v)

    await db.flush()
    await db.refresh(profile)
    return profile
