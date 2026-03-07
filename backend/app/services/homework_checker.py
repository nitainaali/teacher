import json
import re
from typing import Optional, AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import claude, rag, student_intelligence
from app.schemas.schemas import HomeworkFeedback


HOMEWORK_PROMPT = """You are checking a student's homework solution. Analyze the work carefully.

Return a JSON object with exactly this structure (no markdown, raw JSON only):
{
  "overall_correct": <bool>,
  "final_answer_correct": <bool>,
  "score_estimate": "<n>/10",
  "errors": [
    {"step": "<step name>", "description": "<what went wrong>", "correction": "<how to fix>"}
  ],
  "strengths": ["<strength 1>", ...],
  "suggestions": ["<suggestion 1>", ...]
}"""


async def check_homework_stream(
    images_b64: list[str],
    course_id: Optional[str],
    knowledge_mode: str,
    db: AsyncSession,
    language: str = "en",
) -> AsyncGenerator[str, None]:
    """Stream SSE tokens for homework checking."""
    extra_system = HOMEWORK_PROMPT

    if knowledge_mode == "course_only" and course_id and images_b64:
        # Build a text query from a placeholder question for RAG
        context = await rag.retrieve_context(db, "homework solution check", course_id, top_k=5)
        if context:
            extra_system = f"Relevant course materials:\n\n{context}\n\n{HOMEWORK_PROMPT}"

    content = []
    for b64 in images_b64:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        })
    content.append({"type": "text", "text": "Please check this homework solution."})

    full_response = ""
    async for token in claude.stream(
        db=db,
        messages=[{"role": "user", "content": content}],
        course_id=course_id,
        max_tokens=2048,
        extra_system=extra_system,
        language=language,
    ):
        full_response += token
        yield token

    # Write learning event in background (fire and forget)
    try:
        feedback = _parse_feedback(full_response)
        errors_text = "; ".join(e.get("description", "") for e in feedback.get("errors", []))
        await student_intelligence.write_learning_event(
            db=db,
            event_type="homework_error" if not feedback.get("overall_correct") else "quiz_correct",
            course_id=course_id,
            details={"score": feedback.get("score_estimate"), "error": errors_text},
        )
        await db.commit()
    except Exception:
        pass


def _parse_feedback(text: str) -> dict:
    """Extract JSON from Claude response."""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {}
