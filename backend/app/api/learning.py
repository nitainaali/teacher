from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import anthropic as _anthropic

from app.core.database import get_db
from app.models.models import TopicSummary
from app.schemas.schemas import TopicSummaryRequest, TopicSummaryOut, RecommendationExplanationRequest
from app.services import claude, rag
from app.services.recommendations import get_recommendations

router = APIRouter(prefix="/api/learning", tags=["learning"])


@router.post("/topic-summary")
async def topic_summary(data: TopicSummaryRequest, db: AsyncSession = Depends(get_db)):
    """Stream a comprehensive summary of a specific topic from course materials."""

    async def event_generator():
        # Only search knowledge documents (not exam uploads) for topic summaries
        context = await rag.retrieve_context(
            db, data.topic, data.course_id, top_k=15, upload_source="knowledge"
        )
        if context:
            extra_system = (
                f"STRICT RULE: Summarize the topic '{data.topic}' EXCLUSIVELY from the course materials provided below. "
                "Do NOT use any external knowledge or information from your training data. "
                "If a concept is not found in the materials, explicitly say so rather than inventing content.\n\n"
                f"Course materials:\n{context}"
            )
        else:
            extra_system = (
                f"STRICT RULE: You must summarize '{data.topic}' based ONLY on the student's uploaded course materials. "
                "However, NO relevant course materials were found in their documents for this topic. "
                "You MUST inform the student clearly that this topic does not appear in their uploaded materials, "
                "and suggest they upload the relevant lecture notes or textbook chapters first. "
                "Do NOT provide a general explanation of the topic from external knowledge."
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

        full_response = ""
        try:
            async for chunk in claude.stream(
                db=db,
                messages=[{"role": "user", "content": prompt}],
                course_id=data.course_id,
                max_tokens=3000,
                extra_system=extra_system,
                language=data.language,
            ):
                full_response += chunk
                yield f"data: {chunk}\n\n"
        except Exception as e:
            if isinstance(e, _anthropic.APIStatusError):
                error_msg = f"שגיאת Anthropic API ({e.status_code}): {e.message}"
            else:
                error_msg = str(e)[:300]
            yield f"data: [ERROR: {error_msg}]\n\n"
            yield "data: [DONE]\n\n"
            return

        # Auto-save summary to DB after streaming completes
        try:
            summary = TopicSummary(
                course_id=data.course_id,
                topic=data.topic,
                content=full_response,
                guidance=data.guidance,
                language=data.language,
            )
            db.add(summary)
            await db.commit()
        except Exception:
            pass

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/topic-summaries", response_model=List[TopicSummaryOut])
async def list_topic_summaries(
    course_id: str,
    topic: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List saved topic summaries for a course, optionally filtered by topic."""
    query = (
        select(TopicSummary)
        .where(TopicSummary.course_id == course_id)
        .order_by(TopicSummary.created_at.desc())
    )
    if topic:
        query = query.where(TopicSummary.topic == topic)
    result = await db.execute(query)
    return result.scalars().all()


@router.delete("/topic-summaries/{summary_id}", status_code=204)
async def delete_topic_summary(summary_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a specific saved topic summary by ID."""
    result = await db.execute(select(TopicSummary).where(TopicSummary.id == summary_id))
    summary = result.scalar_one_or_none()
    if not summary:
        from fastapi import HTTPException
        raise HTTPException(404, "Summary not found")
    await db.delete(summary)
    await db.commit()


@router.get("/recommendations")
async def recommendations(
    course_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """Get personalized study recommendations for a course."""
    recs = await get_recommendations(db, course_id, limit)
    return recs


@router.post("/recommendation-explanation")
async def recommendation_explanation(
    data: RecommendationExplanationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Stream a Claude-generated explanation of why a topic is recommended and what to strengthen."""

    async def event_generator():
        strength_pct = round(data.strength * 100)
        importance_pct = round(data.importance * 100)

        prompt = (
            f"The student is reviewing their study plan for the topic **{data.topic}**.\n\n"
            f"Learning data:\n"
            f"- Knowledge level: {strength_pct}% (based on quiz and flashcard performance)\n"
            f"- Exam importance: {importance_pct}% (how often this topic appeared in past exams)\n"
            f"- Priority level: {data.urgency_level}\n\n"
            "Please provide a concise explanation (2–3 short paragraphs) covering:\n"
            "1. Why this topic is recommended for review right now\n"
            "2. What specific aspects or skills the student should focus on strengthening\n"
            "3. A brief practical suggestion for how to approach studying it\n\n"
            "Be direct and actionable. Use LaTeX for any math ($...$)."
        )

        try:
            async for chunk in claude.stream(
                db=db,
                messages=[{"role": "user", "content": prompt}],
                course_id=data.course_id,
                max_tokens=500,
                language=data.language,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: [ERROR: {str(e)[:200]}]\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
