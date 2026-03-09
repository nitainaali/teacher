from typing import Optional, AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import ChatSession, ChatMessage
from app.services import claude, rag, student_intelligence


async def get_or_create_session(
    db: AsyncSession,
    session_id: Optional[str],
    course_id: Optional[str],
    knowledge_mode: str,
) -> ChatSession:
    if session_id:
        result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        session = result.scalar_one_or_none()
        if session:
            return session

    session = ChatSession(course_id=course_id, knowledge_mode=knowledge_mode)
    db.add(session)
    await db.flush()
    return session


async def send_message_stream(
    db: AsyncSession,
    message: str,
    session_id: Optional[str],
    course_id: Optional[str],
    knowledge_mode: str,
    language: str = "en",
    source: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    session = await get_or_create_session(db, session_id, course_id, knowledge_mode)

    # Persist user message
    user_msg = ChatMessage(session_id=session.id, role="user", content=message)
    db.add(user_msg)
    await db.flush()

    # Load message history
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at)
    )
    all_messages = result.scalars().all()
    messages_payload = [{"role": m.role, "content": m.content} for m in all_messages]

    extra_system = None
    if knowledge_mode == "course_only" and course_id:
        context = await rag.retrieve_context(db, message, course_id, top_k=5)
        if context:
            extra_system = f"Relevant course materials:\n\n{context}"

    # Yield session_id as first token so frontend can track it
    yield f"[SESSION_ID:{session.id}]"

    full_response = ""
    async for token in claude.stream(
        db=db,
        messages=messages_payload,
        course_id=course_id,
        max_tokens=2048,
        extra_system=extra_system,
        language=language,
    ):
        full_response += token
        yield token

    # Persist assistant response
    assistant_msg = ChatMessage(session_id=session.id, role="assistant", content=full_response)
    db.add(assistant_msg)

    # Write learning event — use isolated type for homework chat so it doesn't
    # pollute the topic summary left panel
    event_type = "homework_chat" if source == "homework_chat" else "chat_question"
    await student_intelligence.write_learning_event(
        db=db,
        event_type=event_type,
        course_id=course_id,
        details={"question": message[:200]},
    )
    await db.commit()
