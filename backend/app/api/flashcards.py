from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import date

from app.core.database import get_db
from app.models.models import Flashcard
from app.schemas.schemas import FlashcardOut, FlashcardReviewRequest
from app.services.flashcard_generator import generate_flashcards
from app.services.sm2 import sm2_next

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


@router.post("/generate", response_model=List[FlashcardOut])
async def generate(
    document_id: str,
    course_id: str,
    count: int = 10,
    db: AsyncSession = Depends(get_db),
):
    cards = await generate_flashcards(db, document_id, course_id, count)
    await db.commit()
    return cards


@router.get("/", response_model=List[FlashcardOut])
async def list_flashcards(
    course_id: Optional[str] = None,
    due_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    query = select(Flashcard).order_by(Flashcard.next_review_date)
    if course_id:
        query = query.where(Flashcard.course_id == course_id)
    if due_only:
        query = query.where(Flashcard.next_review_date <= date.today())
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

    new_ef, new_interval, new_reps, next_date = sm2_next(
        card.ease_factor, card.interval_days, card.repetitions, data.quality
    )
    card.ease_factor = new_ef
    card.interval_days = new_interval
    card.repetitions = new_reps
    card.next_review_date = next_date

    from datetime import datetime, timezone
    card.last_reviewed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(card)
    return card
