"""
Diagnosis endpoint — returns comprehensive learning statistics per course:
  - Activity counts (flashcards studied, quizzes, homework, exams)
  - Per-topic estimated knowledge level (derived from performance events)
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
# Positive weights = evidence of knowledge; negative = evidence of weakness.
# Homework/exam signals have 2× weight as they involve real performance tasks.
PERFORMANCE_WEIGHTS: dict[str, float] = {
    "flashcard_easy":  +1.0,
    "flashcard_hard":  +0.3,   # still slight positive — student is practicing
    "quiz_correct":    +2.0,
    "quiz_wrong":      -2.0,
    "homework_error":  -1.5,
}

MIN_INTERACTIONS = 3    # require at least 3 performance events to show knowledge level
MIN_EXAM_DOCS = 3       # require at least 3 distinct exam documents for exam topic ranking


@router.get("/", response_model=DiagnosisData)
async def get_diagnosis(course_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):

    # ── 1. Activity stats ─────────────────────────────────────────────────────

    # Flashcards studied = total flashcard review events
    fc_q = (
        select(func.count())
        .select_from(LearningEvent)
        .where(LearningEvent.event_type.in_(["flashcard_easy", "flashcard_hard"]))
    )
    if course_id:
        fc_q = fc_q.where(LearningEvent.course_id == course_id)
    flashcards_studied = (await db.execute(fc_q)).scalar() or 0

    # Quizzes completed = quiz sessions with a score
    qz_q = select(func.count()).select_from(QuizSession).where(QuizSession.score.isnot(None))
    if course_id:
        qz_q = qz_q.where(QuizSession.course_id == course_id)
    quizzes_completed = (await db.execute(qz_q)).scalar() or 0

    # Homework submitted = HomeworkSubmission count
    hw_q = select(func.count()).select_from(HomeworkSubmission)
    if course_id:
        hw_q = hw_q.where(HomeworkSubmission.course_id == course_id)
    homework_submitted = (await db.execute(hw_q)).scalar() or 0

    # Exams submitted = ExamAnalysisRecord count (from ExamAnalysisPage)
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

    # ── 2. Per-topic knowledge level ──────────────────────────────────────────

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

    # Aggregate per topic
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

    topics: list[TopicKnowledge] = []
    for topic, count in topic_count.items():
        pos = topic_positive[topic]
        neg = topic_negative[topic]
        if count < MIN_INTERACTIONS:
            topics.append(TopicKnowledge(
                topic=topic,
                knowledge_level=None,
                has_sufficient_data=False,
                total_interactions=count,
            ))
        else:
            total_weight = pos + neg
            level = round(pos / total_weight, 3) if total_weight > 0 else 0.5
            level = max(0.0, min(1.0, level))
            topics.append(TopicKnowledge(
                topic=topic,
                knowledge_level=level,
                has_sufficient_data=True,
                total_interactions=count,
            ))

    # Sort: sufficient data first (by interactions desc), then insufficient data
    topics.sort(key=lambda t: (not t.has_sufficient_data, -t.total_interactions))

    # ── 3. Exam topics by frequency ───────────────────────────────────────────

    exam_q = (
        select(LearningEvent)
        .where(LearningEvent.event_type == "exam_topic")
    )
    if course_id:
        exam_q = exam_q.where(LearningEvent.course_id == course_id)
    exam_events = (await db.execute(exam_q)).scalars().all()

    # Collect distinct document IDs per topic
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
