import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, AsyncGenerator
from app.core.config import settings
from app.services import student_intelligence


BASE_SYSTEM_PROMPT = """You are a precise AI tutor for an electrical engineering student.

ACCURACY RULES — follow these strictly:
- Never fabricate formulas, derivations, values, citations, or solutions you are not certain about.
- If you are unsure about something, say so explicitly: "I'm not certain about this — please verify with your course materials or a reference book."
- For mathematical derivations: show every step clearly. If you skip steps, state explicitly what you are skipping and why.
- Use LaTeX notation for ALL mathematical expressions: $...$ for inline math, $$...$$ for display equations.
- When answering from the provided course materials (RAG context): say "According to your course materials, ..."
- When using general knowledge (not from provided materials): be explicit that this comes from general knowledge, not the student's specific course.
- Prefer exact results over approximations. When approximations are used, state them explicitly (e.g., "using the small-angle approximation sin θ ≈ θ").
- Do not invent circuit values, component specifications, or problem parameters that aren't given.
"""


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
