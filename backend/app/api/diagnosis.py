"""
Diagnosis endpoint — returns comprehensive learning statistics per course:
  - Activity counts (flashcards studied, quizzes, homework, exams)
  - Per-topic estimated knowledge level (derived from performance events)
    Topic list is based on document_topic events (topics extracted from uploaded
    course materials) — not raw interaction history — so only real course topics appear.
  - Exam topics ranked by frequency across past exam documents
"""
from typing import Optional
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models.models import LearningEvent, QuizSession, HomeworkSubmission, ExamAnalysisRecord, Course, User
from app.schemas.schemas import DiagnosisData, DiagnosisStats, TopicKnowledge, ExamTopicWeight
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/diagnosis", tags=["diagnosis"])

# Interaction event types that count toward the knowledge-level threshold.
# Each event has a 0.0–1.0 score in details["score"].
INTERACTION_TYPES = {
    "flashcard_session_complete",
    "quiz_complete",
    "homework_complete",
    "exam_analysis_complete",
}

MIN_INTERACTIONS = 3    # require at least 3 completed interactions to show knowledge level
MIN_EXAM_DOCS = 3       # require at least 3 distinct exam documents for exam topic ranking


@router.get("/", response_model=DiagnosisData)
async def get_diagnosis(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    # ── 1. Activity stats ─────────────────────────────────────────────────────

    fc_q = (
        select(func.count())
        .select_from(LearningEvent)
        .where(
            LearningEvent.event_type == "flashcard_session_complete",
            LearningEvent.user_id == current_user.id,
        )
    )
    if course_id:
        fc_q = fc_q.where(LearningEvent.course_id == course_id)
    flashcards_studied = (await db.execute(fc_q)).scalar() or 0

    qz_q = (
        select(func.count()).select_from(QuizSession)
        .join(Course, QuizSession.course_id == Course.id)
        .where(QuizSession.score.isnot(None), Course.user_id == current_user.id)
    )
    if course_id:
        qz_q = qz_q.where(QuizSession.course_id == course_id)
    quizzes_completed = (await db.execute(qz_q)).scalar() or 0

    hw_q = (
        select(func.count())
        .select_from(HomeworkSubmission)
        .where(HomeworkSubmission.user_id == current_user.id)
    )
    if course_id:
        hw_q = hw_q.where(HomeworkSubmission.course_id == course_id)
    homework_submitted = (await db.execute(hw_q)).scalar() or 0

    ex_q = (
        select(func.count()).select_from(ExamAnalysisRecord)
        .join(Course, ExamAnalysisRecord.course_id == Course.id)
        .where(Course.user_id == current_user.id)
    )
    if course_id:
        ex_q = ex_q.where(ExamAnalysisRecord.course_id == course_id)
    exams_submitted = (await db.execute(ex_q)).scalar() or 0

    stats = DiagnosisStats(
        flashcards_studied=flashcards_studied,
        quizzes_completed=quizzes_completed,
        homework_submitted=homework_submitted,
        exams_submitted=exams_submitted,
    )

    # ── 2. Base topic list — use LLM-merged topics_grouped if available ───────
    # For a specific course: check courses.topics_grouped (LLM-merged canonical list).
    # If null, lazy-init by running the merge now and caching the result.
    # Fallback to raw document_topic events if merge fails or no course_id.

    document_topics: set[str] = set()
    if course_id:
        from app.services.document_processor import _refresh_course_topic_groups
        course_result = await db.execute(select(Course).where(Course.id == course_id))
        course_obj = course_result.scalar_one_or_none()
        if course_obj:
            if course_obj.topics_grouped is None:
                # Lazy init: merge now and cache for future loads
                await _refresh_course_topic_groups(db, course_id)
                await db.refresh(course_obj)
            if course_obj.topics_grouped:
                document_topics = set(course_obj.topics_grouped)

    if not document_topics:
        # Fallback: raw document_topic events (no course filter or merge failed/empty)
        doc_topic_q = (
            select(LearningEvent.topic)
            .where(
                LearningEvent.event_type == "document_topic",
                LearningEvent.topic.isnot(None),
                LearningEvent.user_id == current_user.id,
            )
            .distinct()
        )
        if course_id:
            doc_topic_q = doc_topic_q.where(LearningEvent.course_id == course_id)
        doc_topic_rows = (await db.execute(doc_topic_q)).all()
        document_topics = {row[0] for row in doc_topic_rows}

    # ── 3. Interaction events for knowledge level ─────────────────────────────
    # Each completion event stores a 0.0–1.0 score in details["score"].
    # knowledge_level = mean(score) over all interactions for that topic.

    perf_q = (
        select(LearningEvent)
        .where(
            LearningEvent.event_type.in_(list(INTERACTION_TYPES)),
            LearningEvent.topic.isnot(None),
            LearningEvent.user_id == current_user.id,
        )
    )
    if course_id:
        perf_q = perf_q.where(LearningEvent.course_id == course_id)
    perf_events = (await db.execute(perf_q)).scalars().all()

    topic_scores: dict[str, list[float]] = defaultdict(list)
    topic_count: dict[str, int] = defaultdict(int)

    for event in perf_events:
        topic = event.topic
        topic_count[topic] += 1
        score = (event.details or {}).get("score")
        if score is not None:
            topic_scores[topic].append(float(score))

    # Build TopicKnowledge for each document topic only.
    # Interaction events for topics not in course documents are excluded.
    all_topics = document_topics

    topics: list[TopicKnowledge] = []
    for topic in all_topics:
        count = topic_count.get(topic, 0)
        if count < MIN_INTERACTIONS:
            topics.append(TopicKnowledge(
                topic=topic,
                knowledge_level=None,
                has_sufficient_data=False,
                total_interactions=count,
            ))
        else:
            scores = topic_scores.get(topic, [])
            if scores:
                level = round(sum(scores) / len(scores), 3)
                level = max(0.0, min(1.0, level))
            else:
                level = None
            topics.append(TopicKnowledge(
                topic=topic,
                knowledge_level=level,
                has_sufficient_data=True,
                total_interactions=count,
            ))

    # Sort: sufficient data first (by interactions desc), then insufficient
    topics.sort(key=lambda t: (not t.has_sufficient_data, -t.total_interactions))

    # ── 4. Exam topics by frequency ───────────────────────────────────────────

    exam_q = select(LearningEvent).where(
        LearningEvent.event_type == "exam_topic",
        LearningEvent.user_id == current_user.id,
    )
    if course_id:
        exam_q = exam_q.where(LearningEvent.course_id == course_id)
    exam_events = (await db.execute(exam_q)).scalars().all()

    topic_docs: dict[str, set] = defaultdict(set)
    all_doc_ids: set = set()

    for event in exam_events:
        doc_id = (event.details or {}).get("document_id")
        if doc_id:
            topic_docs[event.topic].add(doc_id)
            all_doc_ids.add(doc_id)

    exam_doc_count = len(all_doc_ids)

    if exam_doc_count >= MIN_EXAM_DOCS:
        max_count = max((len(docs) for docs in topic_docs.values()), default=1)
        exam_topics = [
            ExamTopicWeight(
                topic=topic,
                exam_count=len(docs),
                weight=round(len(docs) / max_count, 3),
            )
            for topic, docs in sorted(topic_docs.items(), key=lambda x: -len(x[1]))
        ]
    else:
        exam_topics = None

    return DiagnosisData(
        stats=stats,
        topics=topics,
        exam_topics=exam_topics,
        exam_doc_count=exam_doc_count,
    )
