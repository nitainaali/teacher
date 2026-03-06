from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import claude, rag
from app.services.student_intelligence import build_student_context

router = APIRouter(prefix="/api/learning", tags=["learning"])


class TopicSummaryRequest(BaseModel):
    course_id: str
    topic: str
    guidance: Optional[str] = None


@router.post("/topic-summary")
async def topic_summary(data: TopicSummaryRequest, db: AsyncSession = Depends(get_db)):
    """Stream a summary of a specific topic from course materials."""

    async def event_generator():
        context = await rag.retrieve_context(db, data.topic, data.course_id, top_k=6)
        guidance_str = f"\n\nStudent guidance: {data.guidance}" if data.guidance else ""
        extra_system = None
        if context:
            extra_system = f"Relevant course materials for topic '{data.topic}':\n\n{context}"

        prompt = (
            f"Please provide a comprehensive summary of the topic: **{data.topic}**{guidance_str}\n\n"
            "Structure your summary with clear sections: key concepts, important formulas or definitions, "
            "and practical applications. Use the course materials provided in context where relevant."
        )

        async for chunk in claude.stream(
            db=db,
            messages=[{"role": "user", "content": prompt}],
            course_id=data.course_id,
            max_tokens=1500,
            extra_system=extra_system,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
