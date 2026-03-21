from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, update
from app.models.models import StudentProfile, LearningEvent
from typing import Optional
import anthropic
from app.core.config import settings


async def build_student_context(
    db: AsyncSession,
    course_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """Build dynamic student context string for injection into Claude system prompt."""
    query = select(StudentProfile)
    if user_id:
        query = query.where(StudentProfile.user_id == user_id)
    else:
        query = query.limit(1)  # fallback for backward compat
    profile_result = await db.execute(query)
    profile = profile_result.scalar_one_or_none()

    events_query = select(LearningEvent).order_by(desc(LearningEvent.created_at)).limit(100)
    if user_id:
        events_query = events_query.where(LearningEvent.user_id == user_id)
    if course_id:
        events_query = events_query.where(LearningEvent.course_id == course_id)
    events_result = await db.execute(events_query)
    events = events_result.scalars().all()

    lines = []

    if profile:
        # Student profile
        parts = []
        if profile.field_of_study:
            parts.append(profile.field_of_study)
        if profile.year_of_study:
            parts.append(f"Year {profile.year_of_study}")
        if profile.institution:
            parts.append(profile.institution)
        if parts:
            lines.append(f"Student profile: {', '.join(parts)}")

        # Teaching style
        style_map = {
            "direct": (
                "Be direct and immediate with corrections. Point out mistakes clearly and precisely "
                "without over-softening. Prioritize accuracy and brevity over encouragement."
            ),
            "balanced": (
                "Balance encouragement with clear, honest corrections. "
                "Acknowledge what's correct before addressing mistakes."
            ),
            "supportive": (
                "Lead with encouragement and positive reinforcement. "
                "Correct gently and constructively, emphasizing progress and growth."
            ),
        }
        style = getattr(profile, "teaching_style", None) or "balanced"
        style_desc = style_map.get(style, style_map["balanced"])
        style_notes = getattr(profile, "style_notes", None)
        extra = f" {style_notes}" if style_notes else ""
        lines.append(f"Teaching style preference: {style_desc}{extra}")

    lines.append("Student learning context (based on recent activity in this course):")

    if not events:
        lines.append("- No recent activity recorded yet.")
        return "\n".join(lines)

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
                recent_chat.append(q[:120])
        elif event.event_type == "homework_error" and event.details:
            e = event.details.get("error", "")
            if e and len(recent_errors) < 3:
                recent_errors.append(e[:120])

    top_struggles = sorted(struggle_topics.items(), key=lambda x: -x[1])[:5]
    top_strengths = sorted(strong_topics.items(), key=lambda x: -x[1])[:5]

    if top_struggles:
        lines.append("- Struggles with: " + ", ".join(f"{t} ({c})" for t, c in top_struggles))
    if top_strengths:
        lines.append("- Strong in: " + ", ".join(f"{t} ({c})" for t, c in top_strengths))
    if recent_chat:
        lines.append("- Recently asked: " + "; ".join(recent_chat))
    if recent_errors:
        lines.append("- Recent homework errors: " + "; ".join(recent_errors))

    return "\n".join(lines)


async def write_learning_event(
    db: AsyncSession,
    event_type: str,
    course_id: Optional[str] = None,
    topic: Optional[str] = None,
    details: Optional[dict] = None,
    user_id: Optional[str] = None,
) -> str:
    """Write a learning event. Returns event ID for later topic update."""
    event = LearningEvent(
        event_type=event_type,
        course_id=course_id,
        topic=topic,
        details=details,
        user_id=user_id,
    )
    db.add(event)
    await db.flush()
    return event.id


async def extract_and_update_topic(
    db: AsyncSession,
    event_id: str,
    interaction_text: str,
) -> None:
    """Extract topic from interaction text and update the learning event. Best-effort."""
    try:
        topic = await extract_topic_background(interaction_text)
        await db.execute(
            update(LearningEvent)
            .where(LearningEvent.id == event_id)
            .values(topic=topic)
        )
        await db.flush()
    except Exception:
        pass


async def extract_topic_background(interaction_text: str) -> str:
    """Fire-and-forget topic extraction via Claude Haiku."""
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
