from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import date, datetime, timezone

from app.core.database import get_db
from app.models.models import Flashcard
from app.schemas.schemas import FlashcardOut, FlashcardReviewRequest
from app.services.flashcard_generator import generate_flashcards
from app.services.fsrs import fsrs_next
from app.services import student_intelligence

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


@router.post("/generate", response_model=List[FlashcardOut])
async def generate(
    document_id: str,
    course_id: str,
    count: int = 20,
    card_type: str = "mixed",
    topic: Optional[str] = None,
    guidance: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    cards = await generate_flashcards(db, document_id, course_id, count, card_type, topic, guidance)
    await db.commit()
    return cards


@router.get("/", response_model=List[FlashcardOut])
async def list_flashcards(
    course_id: Optional[str] = None,
    due_only: bool = False,
    topic: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Flashcard).order_by(Flashcard.next_review_date)
    if course_id:
        query = query.where(Flashcard.course_id == course_id)
    if due_only:
        query = query.where(Flashcard.next_review_date <= date.today())
    if topic:
        query = query.where(Flashcard.topic == topic)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/{card_id}/review", response_model=FlashcardOut)
async def review_flashcard(
    card_id: str,
    data: FlashcardReviewRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")

    # Compute elapsed days since last review
    elapsed_days = 1
    if card.last_reviewed_at:
        delta = datetime.now(timezone.utc) - card.last_reviewed_at
        elapsed_days = max(1, delta.days)

    # Map frontend quality (0=Again,1=Hard,2=Good,3=Easy) → FSRS grade (1-4)
    fsrs_grade = data.quality + 1

    new_s, new_d, interval, new_state, next_date = fsrs_next(
        stability=card.stability or 0.0,
        difficulty=card.difficulty_fsrs or 0.3,
        fsrs_state=card.fsrs_state or "new",
        grade=fsrs_grade,
        elapsed_days=elapsed_days,
    )

    card.stability = new_s
    card.difficulty_fsrs = new_d
    card.fsrs_state = new_state
    card.interval_days = interval
    card.next_review_date = next_date
    card.last_reviewed_at = datetime.now(timezone.utc)

    # Log learning event for student intelligence tracking
    event_type = "flashcard_easy" if fsrs_grade >= 3 else "flashcard_hard"
    await student_intelligence.write_learning_event(
        db=db,
        event_type=event_type,
        course_id=card.course_id,
        topic=card.topic,
        details={"grade": fsrs_grade, "stability": round(new_s, 3), "interval": interval},
    )

    await db.flush()
    await db.refresh(card)
    await db.commit()
    return card
