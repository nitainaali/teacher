from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from datetime import date
from typing import List

from app.core.database import get_db
from app.models.models import Document, Flashcard, QuizSession, LearningEvent
from app.schemas.schemas import ProgressStats, TopicPerformance

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/", response_model=ProgressStats)
async def get_progress(db: AsyncSession = Depends(get_db)):
    total_docs = (await db.execute(select(func.count()).select_from(Document))).scalar() or 0
    total_cards = (await db.execute(select(func.count()).select_from(Flashcard))).scalar() or 0
    due_cards = (
        await db.execute(
            select(func.count()).select_from(Flashcard).where(Flashcard.next_review_date <= date.today())
        )
    ).scalar() or 0
    total_quizzes = (await db.execute(select(func.count()).select_from(QuizSession))).scalar() or 0
    avg_score = (
        await db.execute(select(func.avg(QuizSession.score)).where(QuizSession.score.isnot(None)))
    ).scalar()

    return ProgressStats(
        total_documents=total_docs,
        total_flashcards=total_cards,
        due_flashcards=due_cards,
        total_quizzes=total_quizzes,
        average_quiz_score=avg_score,
    )


@router.get("/topics", response_model=List[TopicPerformance])
async def get_topic_performance(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            LearningEvent.topic,
            func.count().label("event_count"),
        )
        .where(LearningEvent.topic.isnot(None))
        .group_by(LearningEvent.topic)
        .order_by(func.count().desc())
        .limit(20)
    )
    rows = result.all()
    return [
        TopicPerformance(topic=row.topic, avg_score=0.5, event_count=row.event_count)
        for row in rows
    ]
