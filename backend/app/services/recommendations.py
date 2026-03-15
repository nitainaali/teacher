"""
Study recommendations engine.

Algorithm:
  topic_importance = count of 'exam_topic' events / max exam_topic count (0-1)
  student_strength = positive_events / (positive + negative events) per topic (0-1)
                     defaults to 0.5 when no performance data exists
  urgency = topic_importance * (1 - student_strength)

Only topics that appear in BOTH exam events AND document_topic events are included.
This excludes homework-question-like strings that may have been tagged during quizzes.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import LearningEvent


POSITIVE_TYPES = {"quiz_correct", "flashcard_easy"}
NEGATIVE_TYPES = {"quiz_wrong", "homework_error", "flashcard_hard"}


async def get_recommendations(
    db: AsyncSession,
    course_id: str,
    limit: int = 5,
) -> list[dict]:
    result = await db.execute(
        select(LearningEvent).where(LearningEvent.course_id == course_id)
    )
    events = result.scalars().all()

    if not events:
        return []

    # 1. Valid course topics from document_topic events (authoritative topic list)
    valid_topics: set[str] = {
        e.topic for e in events
        if e.event_type == "document_topic" and e.topic
    }

    # 2. Topic importance from exam_topic events (only for valid course topics)
    exam_topic_events = [
        e for e in events
        if e.event_type == "exam_topic" and e.topic and e.topic in valid_topics
    ]
    topic_exam_count: dict[str, int] = {}
    for e in exam_topic_events:
        topic_exam_count[e.topic] = topic_exam_count.get(e.topic, 0) + 1

    if not topic_exam_count:
        return []

    max_exam_count = max(topic_exam_count.values())
    topic_importance: dict[str, float] = {
        t: c / max_exam_count for t, c in topic_exam_count.items()
    }

    # 3. Student strength per topic from performance events
    topic_positive: dict[str, int] = {}
    topic_negative: dict[str, int] = {}

    for e in events:
        if not e.topic:
            continue
        if e.event_type in POSITIVE_TYPES:
            topic_positive[e.topic] = topic_positive.get(e.topic, 0) + 1
        elif e.event_type in NEGATIVE_TYPES:
            topic_negative[e.topic] = topic_negative.get(e.topic, 0) + 1

    # 4. Compute urgency for each exam topic in the valid set
    recommendations = []
    for topic, importance in topic_importance.items():
        pos = topic_positive.get(topic, 0)
        neg = topic_negative.get(topic, 0)
        total = pos + neg
        # Default to 0.5 strength when no performance data (unknown = assume average)
        strength = (pos / total) if total > 0 else 0.5
        urgency = importance * (1.0 - strength)

        if urgency < 0.05:
            continue  # Skip low-urgency topics

        if urgency >= 0.5:
            level = "high"
        elif urgency >= 0.2:
            level = "medium"
        else:
            level = "low"

        reason_parts = []
        if importance >= 0.5:
            reason_parts.append("appears frequently in past exams")
        if strength < 0.4:
            reason_parts.append("needs more practice based on your history")
        reason = " and ".join(reason_parts) if reason_parts else "recommended for review"

        recommendations.append({
            "topic": topic,
            "urgency": round(urgency, 3),
            "urgency_level": level,
            "reason": reason,
            "strength": round(strength, 2),
            "importance": round(importance, 2),
        })

    recommendations.sort(key=lambda x: -x["urgency"])
    return recommendations[:limit]
