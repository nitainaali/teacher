from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from datetime import date
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Document, Flashcard, QuizSession, LearningEvent
from app.schemas.schemas import ProgressStats, TopicPerformance

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/", response_model=ProgressStats)
async def get_progress(course_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    doc_q = select(func.count()).select_from(Document)
    card_q = select(func.count()).select_from(Flashcard)
    due_q = select(func.count()).select_from(Flashcard).where(Flashcard.next_review_date <= date.today())
    quiz_q = select(func.count()).select_from(QuizSession)
    avg_q = select(func.avg(QuizSession.score)).where(QuizSession.score.isnot(None))

    if course_id:
        doc_q = doc_q.where(Document.course_id == course_id)
        card_q = card_q.where(Flashcard.course_id == course_id)
        due_q = due_q.where(Flashcard.course_id == course_id)
        quiz_q = quiz_q.where(QuizSession.course_id == course_id)
        avg_q = avg_q.where(QuizSession.course_id == course_id)

    total_docs = (await db.execute(doc_q)).scalar() or 0
    total_cards = (await db.execute(card_q)).scalar() or 0
    due_cards = (await db.execute(due_q)).scalar() or 0
    total_quizzes = (await db.execute(quiz_q)).scalar() or 0
    avg_score = (await db.execute(avg_q)).scalar()

    return ProgressStats(
        total_documents=total_docs,
        total_flashcards=total_cards,
        due_flashcards=due_cards,
        total_quizzes=total_quizzes,
        average_quiz_score=avg_score,
    )


@router.get("/topics", response_model=List[TopicPerformance])
async def get_topic_performance(course_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = (
        select(
            LearningEvent.topic,
            func.count().label("event_count"),
        )
        .where(LearningEvent.topic.isnot(None))
    )
    if course_id:
        query = query.where(LearningEvent.course_id == course_id)
    query = query.group_by(LearningEvent.topic).order_by(func.count().desc()).limit(20)
    result = await db.execute(query)
    rows = result.all()
    return [
        TopicPerformance(topic=row.topic, avg_score=0.5, event_count=row.event_count)
        for row in rows
    ]
