from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import claude, rag
from app.services.recommendations import get_recommendations

router = APIRouter(prefix="/api/learning", tags=["learning"])


class TopicSummaryRequest(BaseModel):
    course_id: str
    topic: str
    guidance: Optional[str] = None


@router.post("/topic-summary")
async def topic_summary(data: TopicSummaryRequest, db: AsyncSession = Depends(get_db)):
    """Stream a comprehensive summary of a specific topic from course materials."""

    async def event_generator():
        context = await rag.retrieve_context(db, data.topic, data.course_id, top_k=6)
        extra_system = None
        if context:
            extra_system = (
                f"You are summarizing the topic '{data.topic}' for the student using their course materials.\n"
                "IMPORTANT: Base your summary on the provided course materials. "
                "If a concept is not covered in the materials, say so explicitly rather than inventing content.\n\n"
                f"Relevant course materials:\n{context}"
            )

        guidance_str = f"\n\nAdditional instruction from student: {data.guidance}" if data.guidance else ""
        prompt = (
            f"Provide a comprehensive summary of the topic: **{data.topic}**\n\n"
            "Structure your summary:\n"
            "1. **Core concept** — what it is and why it matters\n"
            "2. **Key formulas and equations** — use LaTeX: $...$ inline, $$...$$ display\n"
            "3. **Important properties and rules**\n"
            "4. **Common applications and examples**\n"
            "5. **Common mistakes to avoid**\n"
            f"{guidance_str}"
        )

        try:
            async for chunk in claude.stream(
                db=db,
                messages=[{"role": "user", "content": prompt}],
                course_id=data.course_id,
                max_tokens=3000,
                extra_system=extra_system,
            ):
                yield f"data: {chunk}\n\n"
        except Exception:
            yield "data: [ERROR]\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/recommendations")
async def recommendations(
    course_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """Get personalized study recommendations for a course."""
    recs = await get_recommendations(db, course_id, limit)
    return recs
