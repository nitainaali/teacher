from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.models import Course
from app.schemas.schemas import CourseCreate, CourseUpdate, CourseOut
from typing import List

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.get("/", response_model=List[CourseOut])
async def list_courses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Course).order_by(Course.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=CourseOut, status_code=201)
async def create_course(data: CourseCreate, db: AsyncSession = Depends(get_db)):
    course = Course(**data.model_dump())
    db.add(course)
    await db.flush()
    await db.refresh(course)
    return course


@router.get("/{course_id}", response_model=CourseOut)
async def get_course(course_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    return course


@router.put("/{course_id}", response_model=CourseOut)
async def update_course(course_id: str, data: CourseUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(course, k, v)
    await db.flush()
    await db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=204)
async def delete_course(course_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    await db.delete(course)
