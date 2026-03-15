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
from app.models.models import LearningEvent, QuizSession, HomeworkSubmission, ExamAnalysisRecord
from app.schemas.schemas import DiagnosisData, DiagnosisStats, TopicKnowledge, ExamTopicWeight

router = APIRouter(prefix="/api/diagnosis", tags=["diagnosis"])

# Performance events and their weights for knowledge level estimation.
PERFORMANCE_WEIGHTS: dict[str, float] = {
    "flashcard_easy":  +1.0,
    "flashcard_hard":  +0.3,
    "quiz_correct":    +2.0,
    "quiz_wrong":      -2.0,
    "homework_error":  -1.5,
}

MIN_INTERACTIONS = 3    # require at least 3 performance events to show knowledge level
MIN_EXAM_DOCS = 3       # require at least 3 distinct exam documents for exam topic ranking


@router.get("/", response_model=DiagnosisData)
async def get_diagnosis(course_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):

    # ── 1. Activity stats ─────────────────────────────────────────────────────

    fc_q = (
        select(func.count())
        .select_from(LearningEvent)
        .where(LearningEvent.event_type.in_(["flashcard_easy", "flashcard_hard"]))
    )
    if course_id:
        fc_q = fc_q.where(LearningEvent.course_id == course_id)
    flashcards_studied = (await db.execute(fc_q)).scalar() or 0

    qz_q = select(func.count()).select_from(QuizSession).where(QuizSession.score.isnot(None))
    if course_id:
        qz_q = qz_q.where(QuizSession.course_id == course_id)
    quizzes_completed = (await db.execute(qz_q)).scalar() or 0

    hw_q = select(func.count()).select_from(HomeworkSubmission)
    if course_id:
        hw_q = hw_q.where(HomeworkSubmission.course_id == course_id)
    homework_submitted = (await db.execute(hw_q)).scalar() or 0

    ex_q = select(func.count()).select_from(ExamAnalysisRecord)
    if course_id:
        ex_q = ex_q.where(ExamAnalysisRecord.course_id == course_id)
    exams_submitted = (await db.execute(ex_q)).scalar() or 0

    stats = DiagnosisStats(
        flashcards_studied=flashcards_studied,
        quizzes_completed=quizzes_completed,
        homework_submitted=homework_submitted,
        exams_submitted=exams_submitted,
    )

    # ── 2. Base topic list from document_topic events ────────────────────────
    # Using document-extracted topics ensures only real course topics appear,
    # not transient topics from chat sessions or homework questions.

    doc_topic_q = (
        select(LearningEvent.topic)
        .where(
            LearningEvent.event_type == "document_topic",
            LearningEvent.topic.isnot(None),
        )
        .distinct()
    )
    if course_id:
        doc_topic_q = doc_topic_q.where(LearningEvent.course_id == course_id)
    doc_topic_rows = (await db.execute(doc_topic_q)).all()
    document_topics: set[str] = {row[0] for row in doc_topic_rows}

    # ── 3. Performance events for knowledge level ─────────────────────────────

    perf_q = (
        select(LearningEvent)
        .where(
            LearningEvent.event_type.in_(list(PERFORMANCE_WEIGHTS.keys())),
            LearningEvent.topic.isnot(None),
        )
    )
    if course_id:
        perf_q = perf_q.where(LearningEvent.course_id == course_id)
    perf_events = (await db.execute(perf_q)).scalars().all()

    topic_positive: dict[str, float] = defaultdict(float)
    topic_negative: dict[str, float] = defaultdict(float)
    topic_count: dict[str, int] = defaultdict(int)

    for event in perf_events:
        topic = event.topic
        w = PERFORMANCE_WEIGHTS.get(event.event_type, 0.0)
        if w > 0:
            topic_positive[topic] += w
        else:
            topic_negative[topic] += abs(w)
        topic_count[topic] += 1

    # Build TopicKnowledge for each document topic (+ any with performance data)
    all_topics = document_topics | set(topic_count.keys())

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
            pos = topic_positive[topic]
            neg = topic_negative[topic]
            total_weight = pos + neg
            level = round(pos / total_weight, 3) if total_weight > 0 else 0.5
            level = max(0.0, min(1.0, level))
            topics.append(TopicKnowledge(
                topic=topic,
                knowledge_level=level,
                has_sufficient_data=True,
                total_interactions=count,
            ))

    # Sort: sufficient data first (by interactions desc), then insufficient
    topics.sort(key=lambda t: (not t.has_sufficient_data, -t.total_interactions))

    # ── 4. Exam topics by frequency ───────────────────────────────────────────

    exam_q = select(LearningEvent).where(LearningEvent.event_type == "exam_topic")
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
