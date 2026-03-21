"""User management API — login screen + user creation."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.models.models import User
from app.schemas.schemas import UserCreate, UserOut
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=List[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)):
    """Return all users — used by the login screen to display user cards."""
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.post("/", response_model=UserOut, status_code=201)
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    """Create a new user. Returns 409 if username already taken."""
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(username=data.username.strip(), is_admin=False)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the current user identified by X-User-Id header."""
    return current_user
