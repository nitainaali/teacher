from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.models.models import ChatSession, ChatMessage, User
from app.schemas.schemas import ChatMessageRequest, ChatSessionOut, ChatMessageOut, ChatSessionWithFirstMessage
from app.services.chat import send_message_stream
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/message")
async def send_message(
    data: ChatMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = current_user.id

    async def event_generator():
        try:
            async for chunk in send_message_stream(
                db=db,
                message=data.message,
                session_id=data.session_id,
                course_id=data.course_id,
                knowledge_mode=data.knowledge_mode,
                language=data.language,
                source=data.source,
                images=data.images,
                context_seed=data.context_seed,
                user_id=user_id,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: [ERROR:{str(e)[:200]}]\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/sessions", response_model=List[ChatSessionWithFirstMessage])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Subquery: first user message content per session
    first_msg_subq = (
        select(ChatMessage.content)
        .where(
            ChatMessage.session_id == ChatSession.id,
            ChatMessage.role == "user",
        )
        .order_by(ChatMessage.created_at)
        .limit(1)
        .scalar_subquery()
    )
    result = await db.execute(
        select(ChatSession, first_msg_subq.label("first_message"))
        .where(
            ChatSession.source.notin_(["homework_chat", "exam_chat"]),  # hide follow-up chats
            ChatSession.user_id == current_user.id,
        )
        .order_by(ChatSession.updated_at.desc())
    )
    rows = result.all()
    out = []
    for session, first_message in rows:
        out.append(ChatSessionWithFirstMessage(
            id=session.id,
            course_id=session.course_id,
            knowledge_mode=session.knowledge_mode,
            created_at=session.created_at,
            updated_at=session.updated_at,
            first_message=first_message,
        ))
    return out


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageOut])
async def get_messages(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )
    if not session_result.scalar_one_or_none():
        raise HTTPException(404, "Session not found")
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
