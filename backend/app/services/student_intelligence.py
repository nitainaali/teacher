from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.models.models import StudentProfile, LearningEvent
from typing import Optional
import anthropic
from app.core.config import settings


async def build_student_context(db: AsyncSession, course_id: Optional[str] = None) -> str:
    """Build dynamic student context string for injection into Claude system prompt."""
    # Fetch student profile
    profile_result = await db.execute(select(StudentProfile).limit(1))
    profile = profile_result.scalar_one_or_none()

    # Fetch recent learning events
    query = select(LearningEvent).order_by(desc(LearningEvent.created_at)).limit(50)
    if course_id:
        query = query.where(LearningEvent.course_id == course_id)
    events_result = await db.execute(query)
    events = events_result.scalars().all()

    lines = ["Student context (based on recent activity):"]

    if profile:
        parts = []
        if profile.field_of_study:
            parts.append(profile.field_of_study)
        if profile.year_of_study:
            parts.append(f"Year {profile.year_of_study}")
        if profile.institution:
            parts.append(profile.institution)
        if parts:
            lines.insert(0, f"Student profile:\n- {', '.join(parts)}\n")

    if not events:
        lines.append("- No recent activity recorded yet.")
        return "\n".join(lines)

    # Aggregate by topic
    struggle_topics: dict[str, int] = {}
    strong_topics: dict[str, int] = {}
    recent_chat: list[str] = []
    recent_errors: list[str] = []

    error_types = {"quiz_wrong", "homework_error", "flashcard_hard"}
    strength_types = {"quiz_correct", "flashcard_easy"}

    for event in events:
        topic = event.topic or "unknown"
        if event.event_type in error_types:
            struggle_topics[topic] = struggle_topics.get(topic, 0) + 1
        elif event.event_type in strength_types:
            strong_topics[topic] = strong_topics.get(topic, 0) + 1
        elif event.event_type == "chat_question" and event.details:
            q = event.details.get("question", "")
            if q and len(recent_chat) < 3:
                recent_chat.append(q[:100])
        elif event.event_type == "homework_error" and event.details:
            e = event.details.get("error", "")
            if e and len(recent_errors) < 3:
                recent_errors.append(e[:100])

    top_struggles = sorted(struggle_topics.items(), key=lambda x: -x[1])[:3]
    top_strengths = sorted(strong_topics.items(), key=lambda x: -x[1])[:3]

    if top_struggles:
        lines.append("- Struggles with: " + ", ".join(t for t, _ in top_struggles))
    if top_strengths:
        lines.append("- Strong in: " + ", ".join(t for t, _ in top_strengths))
    if recent_chat:
        lines.append("- Recently asked in chat: " + "; ".join(recent_chat))
    if recent_errors:
        lines.append("- Recent homework errors: " + "; ".join(recent_errors))

    return "\n".join(lines)


async def write_learning_event(
    db: AsyncSession,
    event_type: str,
    course_id: Optional[str] = None,
    topic: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    event = LearningEvent(
        event_type=event_type,
        course_id=course_id,
        topic=topic,
        details=details,
    )
    db.add(event)
    await db.flush()


async def extract_topic_background(interaction_text: str) -> str:
    """Fire-and-forget topic extraction via a lightweight Claude call."""
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20,
            messages=[{
                "role": "user",
                "content": (
                    "What is the specific engineering/math topic of the following interaction? "
                    "Reply with 2-4 words only, no explanation.\n\n"
                    f"Interaction: {interaction_text[:500]}"
                ),
            }],
        )
        return response.content[0].text.strip()
    except Exception:
        return "unknown"
