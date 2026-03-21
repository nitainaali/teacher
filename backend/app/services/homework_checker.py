import anthropic
from typing import Optional, AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import claude, rag, student_intelligence
from app.core.config import settings


async def _extract_homework_topic(
    full_response: str,
    user_description: Optional[str],
) -> str:
    """Extract a single Hebrew topic from the homework content using Claude Haiku."""
    desc_part = user_description[:300] if user_description else ""
    analysis_part = full_response[:400]
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": (
                    "Based on this homework problem, what is the engineering/math topic? "
                    "Return a short topic name in Hebrew (עברית), 2-4 words only.\n\n"
                    f"Problem description: {desc_part}\n"
                    f"AI feedback beginning: {analysis_part}"
                ),
            }],
        )
        return response.content[0].text.strip() or "כללי"
    except Exception:
        return "כללי"


def _homework_score(analysis_text: str) -> float:
    """Parse the homework AI analysis to determine a 0.0–1.0 performance score."""
    lower = analysis_text.lower()
    if "partially correct" in lower or "חלקית" in lower:
        return 0.5
    if any(phrase in lower for phrase in ["incorrect", "שגוי", "לא נכון", " wrong"]):
        return 0.0
    return 1.0  # default: assume correct if no failure signal


# ── Prompts — one per logical mode ────────────────────────────────────────────

HOMEWORK_CHECK_PROMPT = """You are checking a student's homework solution. Analyze the work carefully and provide feedback in clear, well-structured markdown.

Include the following sections:
- **Score**: e.g. 8/10
- **Overall verdict**: correct / partially correct / incorrect
- **Errors** (if any): For each error, describe the step, what went wrong, and how to fix it
- **Strengths**: What the student did well
- **Suggestions**: How to improve

Use LaTeX for all mathematical expressions ($...$ for inline, $$...$$ for display).
Write in a clear, educational tone."""

HOMEWORK_HELP_PROMPTS = {
    1: """You are helping a student who is stuck on a homework problem. Provide a SMALL HINT only — point them in the right direction conceptually. Do NOT show calculation steps, do NOT compute anything, do NOT reveal the answer. Keep your response to one short paragraph maximum.""",
    2: """You are helping a student who is stuck on a homework problem. Walk through the APPROACH and KEY STEPS in a structured way. Explain the method and the reasoning behind each step, but do NOT compute or reveal the final numerical answer — let the student complete that themselves. Use LaTeX for mathematical expressions ($...$ inline, $$...$$ display).""",
    3: """You are helping a student who is stuck on a homework problem. Provide a COMPLETE, DETAILED SOLUTION from start to finish. Explain every step clearly and show all working. Use LaTeX for all mathematical expressions ($...$ inline, $$...$$ display). Write in a clear, educational tone.""",
}


async def check_homework_stream(
    images_b64: list[str],
    course_id: Optional[str],
    knowledge_mode: str,
    db: AsyncSession,
    language: str = "en",
    user_description: Optional[str] = None,
    mode: str = "check",        # "check" | "help"
    revelation_level: int = 1,  # 1 | 2 | 3  (only used when mode == "help")
    user_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream SSE tokens for homework checking or solving help."""

    # Select prompt based on mode
    if mode == "help":
        base_prompt = HOMEWORK_HELP_PROMPTS.get(revelation_level, HOMEWORK_HELP_PROMPTS[1])
    else:
        base_prompt = HOMEWORK_CHECK_PROMPT

    extra_system = base_prompt

    # Course-only RAG: prepend context and restrict knowledge
    if knowledge_mode == "course_only" and course_id and images_b64:
        context = await rag.retrieve_context(db, "homework solution check", course_id, top_k=5)
        if context:
            extra_system = (
                f"Relevant course materials:\n\n{context}\n\n"
                "IMPORTANT: Base your analysis ONLY on the course materials provided above. "
                "Do not draw on general knowledge beyond what is in these materials.\n\n"
                + base_prompt
            )

    content = []
    for b64 in images_b64:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        })
    text = "Please check this homework solution." if mode == "check" else "Please help me with this homework problem."
    if user_description:
        text = f"Student's note: {user_description}\n\n{text}"
    content.append({"type": "text", "text": text})

    full_response = ""
    async for token in claude.stream(
        db=db,
        messages=[{"role": "user", "content": content}],
        course_id=course_id,
        max_tokens=2048,
        extra_system=extra_system,
        language=language,
        user_id=user_id,
    ):
        full_response += token
        yield token

    # Write learning event (backward-compat: kept for recommendations engine)
    event_type = "homework_check" if mode == "check" else "homework_help"
    try:
        await student_intelligence.write_learning_event(
            db=db,
            event_type=event_type,
            course_id=course_id,
            details={"revelation_level": revelation_level} if mode == "help" else {},
            user_id=user_id,
        )
        # Write homework_complete diagnosis event only for actual check submissions
        if mode == "check":
            topic = await _extract_homework_topic(full_response, user_description)
            score = _homework_score(full_response)
            await student_intelligence.write_learning_event(
                db=db,
                event_type="homework_complete",
                course_id=course_id,
                topic=topic,
                details={"score": score},
                user_id=user_id,
            )
        await db.commit()
    except Exception:
        pass
