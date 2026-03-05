import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, AsyncGenerator
from app.core.config import settings
from app.services import student_intelligence


BASE_SYSTEM_PROMPT = (
    "You are an expert electrical engineering tutor helping a university student master "
    "their coursework. You provide clear, step-by-step explanations with mathematical "
    "precision. You identify misconceptions, highlight errors constructively, and adapt "
    "to the student's level. When relevant, reference course materials provided in the context."
)


async def build_system_prompt(db: AsyncSession, course_id: Optional[str] = None) -> str:
    profile_context = await student_intelligence.build_student_context(db, course_id)
    return f"{BASE_SYSTEM_PROMPT}\n\n{profile_context}"


async def complete(
    db: AsyncSession,
    messages: list[dict],
    course_id: Optional[str] = None,
    max_tokens: int = 2048,
    extra_system: Optional[str] = None,
) -> str:
    """Non-streaming Claude completion with student context injected."""
    system = await build_system_prompt(db, course_id)
    if extra_system:
        system = f"{system}\n\n{extra_system}"

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return response.content[0].text


async def stream(
    db: AsyncSession,
    messages: list[dict],
    course_id: Optional[str] = None,
    max_tokens: int = 2048,
    extra_system: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming Claude completion with student context injected."""
    system = await build_system_prompt(db, course_id)
    if extra_system:
        system = f"{system}\n\n{extra_system}"

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    async with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    ) as stream_ctx:
        async for text in stream_ctx.text_stream:
            yield text
