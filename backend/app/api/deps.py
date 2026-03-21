"""FastAPI dependencies for multi-user support."""
from fastapi import Request, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import User


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Read the X-User-Id header and validate against the users table.
    Raises 401 if the header is missing or the user does not exist.
    """
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Unknown user")

    return user


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Like get_current_user but requires is_admin=True."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
