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

FORMATTING RULES:
- Use clear structure: headers, bullet points, and proper spacing between sections.
- Add blank lines between paragraphs for readability.
- When switching between explanation and math, always separate them with a line break.
"""


async def build_system_prompt(
    db: AsyncSession,
    course_id: Optional[str] = None,
    language: str = "en",
) -> str:
    profile_context = await student_intelligence.build_student_context(db, course_id)
    if language == "he":
        lang_instruction = (
            "LANGUAGE: Respond in Hebrew (עברית). "
            "Variable names, code, and equations — keep in English/Latin as-is. "
            "Avoid mixing languages mid-sentence; if unavoidable, add a space between Hebrew and Latin text and prefer breaking to a new line.\n"
            "הסבר בעברית. שמות משתנים, קוד ומשוואות — השאר באנגלית. "
            "השתדל להימנע ממעבר שפות באמצע משפט; אם אין ברירה — הוסף רווחים משמעותיים בין עברית לאנגלית ורד שורה."
        )
    else:
        lang_instruction = "LANGUAGE REQUIREMENT: Respond in English."
    return f"{BASE_SYSTEM_PROMPT}\n\n{lang_instruction}\n\n{profile_context}"


async def complete(
    db: AsyncSession,
    messages: list[dict],
    course_id: Optional[str] = None,
    max_tokens: int = 2048,
    extra_system: Optional[str] = None,
    language: str = "en",
    model: Optional[str] = None,
) -> str:
    """Non-streaming Claude completion with student context injected."""
    system = await build_system_prompt(db, course_id, language=language)
    if extra_system:
        system = f"{system}\n\n{extra_system}"

    _model = model or "claude-sonnet-4-6"
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    response = await client.messages.create(
        model=_model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return response.content[0].text


async def complete_with_system(
    system: str,
    messages: list[dict],
    max_tokens: int = 2048,
    model: Optional[str] = None,
) -> str:
    """Non-streaming Claude completion with pre-built system prompt (no DB access).
    Used for parallel flashcard generation to avoid shared session conflicts."""
    _model = model or "claude-sonnet-4-6"
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    response = await client.messages.create(
        model=_model,
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
    language: str = "en",
) -> AsyncGenerator[str, None]:
    """Streaming Claude completion with student context injected."""
    system = await build_system_prompt(db, course_id, language=language)
    if extra_system:
        system = f"{system}\n\n{extra_system}"

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    async with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    ) as stream_ctx:
        async for text in stream_ctx.text_stream:
            yield text
