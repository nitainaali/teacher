from typing import Optional, AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.models import ChatSession, ChatMessage
from app.services import claude, rag, student_intelligence


def _detect_media_type(b64: str) -> str:
    """Detect image media type from base64 header bytes."""
    if b64.startswith("/9j/"):
        return "image/jpeg"
    elif b64.startswith("iVBOR"):
        return "image/png"
    elif b64.startswith("JVBERi"):
        return "application/pdf"
    return "image/jpeg"  # fallback


async def get_or_create_session(
    db: AsyncSession,
    session_id: Optional[str],
    course_id: Optional[str],
    knowledge_mode: str,
    source: str = "chat",
    user_id: Optional[str] = None,
) -> ChatSession:
    if session_id:
        result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        session = result.scalar_one_or_none()
        if session:
            return session

    session = ChatSession(course_id=course_id, knowledge_mode=knowledge_mode, source=source, user_id=user_id)
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
    images: Optional[list[str]] = None,
    context_seed: Optional[str] = None,
    user_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    session = await get_or_create_session(db, session_id, course_id, knowledge_mode, source=source or "chat", user_id=user_id)

    # If a context_seed is provided, insert it as the first assistant message in a
    # brand-new session so that all follow-up turns have the full analysis in context.
    if context_seed and context_seed.strip():
        count_result = await db.execute(
            select(func.count()).where(ChatMessage.session_id == session.id)
        )
        existing_count = count_result.scalar() or 0
        if existing_count == 0:
            seed_msg = ChatMessage(
                session_id=session.id,
                role="assistant",
                content=context_seed.strip(),
            )
            db.add(seed_msg)
            await db.flush()

    # Persist session images (first time only) so all follow-up turns retain visual context.
    if images and session.images_b64 is None:
        capped = images[:3]
        total_len = sum(len(b) for b in capped)
        if total_len > 6_000_000:
            capped = images[:1]  # Fallback: keep only first image if total is too large
        session.images_b64 = capped
        await db.flush()

    # Persist user message (text only — images are stored at session level, not per message)
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

    # Build messages payload.
    # Session images (if any) are injected into the FIRST user turn so Claude retains
    # visual context across all follow-up turns — not just the current one.
    session_images = session.images_b64 or []
    first_user_injected = False
    messages_payload = []
    for m in all_messages:
        if m.role == "user" and not first_user_injected and session_images:
            first_user_injected = True
            content: list = []
            for img_b64 in session_images:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": _detect_media_type(img_b64),
                        "data": img_b64,
                    },
                })
            content.append({"type": "text", "text": m.content})
            messages_payload.append({"role": "user", "content": content})
        else:
            messages_payload.append({"role": m.role, "content": m.content})

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
        user_id=user_id,
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
        user_id=user_id,
    )
    await db.commit()
