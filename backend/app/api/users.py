"""User management API — login screen + user creation."""
from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.models.models import User
from app.schemas.schemas import UserCreate, UserOut
from app.api.deps import get_current_user, get_admin_user

router = APIRouter(prefix="/api/users", tags=["users"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class PasswordVerifyRequest(BaseModel):
    user_id: str
    password: str


@router.get("/", response_model=List[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)):
    """Return all users — used by the login screen to display user cards."""
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.post("/verify-password")
async def verify_password(body: PasswordVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Verify the password for a user who has password protection enabled."""
    result = await db.execute(select(User).where(User.id == body.user_id))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(status_code=400, detail="No password set for this user")
    if not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")
    return {"ok": True}


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


@router.delete("/me", status_code=204)
async def delete_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete the currently logged-in user and all their data."""
    await db.delete(current_user)
    await db.commit()


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Admin: delete any user by ID."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
