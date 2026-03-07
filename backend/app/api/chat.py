from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.models.models import ChatSession, ChatMessage
from app.schemas.schemas import ChatMessageRequest, ChatSessionOut, ChatMessageOut
from app.services.chat import send_message_stream

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/message")
async def send_message(data: ChatMessageRequest, db: AsyncSession = Depends(get_db)):
    async def event_generator():
        try:
            async for chunk in send_message_stream(
                db=db,
                message=data.message,
                session_id=data.session_id,
                course_id=data.course_id,
                knowledge_mode=data.knowledge_mode,
                language=data.language,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: [ERROR:{str(e)[:200]}]\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/sessions", response_model=List[ChatSessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatSession).order_by(ChatSession.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageOut])
async def get_messages(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
