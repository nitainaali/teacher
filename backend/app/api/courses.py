from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.core.database import get_db
from app.models.models import Course, User
from app.schemas.schemas import (
    CourseCreate, CourseUpdate, CourseOut, CourseReorderRequest,
    ActiveSharedCoursesUpdate,
)
from app.api.deps import get_current_user
from typing import List

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.get("/", response_model=List[CourseOut])
async def list_courses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course)
        .where(Course.user_id == current_user.id)
        .order_by(Course.sort_order, Course.created_at)
    )
    return result.scalars().all()


@router.post("/", response_model=CourseOut, status_code=201)
async def create_course(
    data: CourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.user_id == current_user.id)
    )
    count = len(result.scalars().all())
    course = Course(**data.model_dump(), user_id=current_user.id, sort_order=count)
    db.add(course)
    await db.flush()
    await db.refresh(course)
    return course


@router.post("/reorder", status_code=204)
async def reorder_courses(
    data: CourseReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update sort_order for all courses based on the provided ordered ID list."""
    for idx, course_id in enumerate(data.ids):
        await db.execute(
            update(Course)
            .where(Course.id == course_id, Course.user_id == current_user.id)
            .values(sort_order=idx)
        )
    await db.flush()


@router.get("/{course_id}", response_model=CourseOut)
async def get_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.user_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    return course


@router.put("/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: str,
    data: CourseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.user_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(course, k, v)
    await db.flush()
    await db.refresh(course)
    return course


@router.put("/{course_id}/active-shared-courses", response_model=CourseOut)
async def update_active_shared_courses(
    course_id: str,
    data: ActiveSharedCoursesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set which shared knowledge courses are active for RAG in this course."""
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.user_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    course.active_shared_course_ids = data.shared_course_ids
    await db.flush()
    await db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=204)
async def delete_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.user_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(404, "Course not found")
    await db.delete(course)
