from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import date, datetime, timezone

from app.core.database import get_db
from app.models.models import Flashcard, FlashcardDeck, Document
from app.schemas.schemas import FlashcardOut, FlashcardReviewRequest, FlashcardDeckOut, FlashcardDeckRename
from app.services.flashcard_generator import generate_flashcards
from app.services.fsrs import fsrs_next
from app.services import student_intelligence

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


# ── Deck endpoints ────────────────────────────────────────────────────────────

@router.get("/decks", response_model=List[FlashcardDeckOut])
async def list_decks(
    course_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FlashcardDeck)
        .where(FlashcardDeck.course_id == course_id)
        .order_by(FlashcardDeck.created_at.desc())
    )
    return result.scalars().all()


@router.get("/decks/{deck_id}/cards", response_model=List[FlashcardOut])
async def get_deck_cards(deck_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Flashcard).where(Flashcard.deck_id == deck_id).order_by(Flashcard.next_review_date)
    )
    return result.scalars().all()


@router.put("/decks/{deck_id}", response_model=FlashcardDeckOut)
async def rename_deck(deck_id: str, data: FlashcardDeckRename, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(404, "Deck not found")
    deck.name = data.name
    await db.flush()
    await db.refresh(deck)
    await db.commit()
    return deck


@router.delete("/decks/{deck_id}", status_code=204)
async def delete_deck(deck_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(404, "Deck not found")
    await db.delete(deck)
    await db.commit()


# ── Generate (creates a new deck) ────────────────────────────────────────────

@router.post("/generate", response_model=FlashcardDeckOut)
async def generate(
    course_id: str,
    count: int = 60,
    card_type: str = "mixed",
    difficulty: str = "medium",
    topic: Optional[str] = None,
    guidance: Optional[str] = None,
    language: str = "en",
    db: AsyncSession = Depends(get_db),
):
    # Fetch all processed non-exam documents for the course
    docs_result = await db.execute(
        select(Document).where(
            Document.course_id == course_id,
            Document.processing_status == "done",
            Document.doc_type != "exam",
        )
    )
    docs = docs_result.scalars().all()
    if not docs:
        raise HTTPException(
            status_code=422,
            detail="No processed documents found for this course. Upload documents and wait for processing to finish.",
        )

    # Create deck
    deck_name = f"{topic or card_type.title()} — {count} cards"
    deck = FlashcardDeck(
        course_id=course_id,
        name=deck_name,
        topic=topic,
        difficulty=difficulty,
        card_count=0,
    )
    db.add(deck)
    await db.flush()

    # Generate cards distributed across all docs
    per_doc_count = max(5, count // len(docs))
    all_cards: List[Flashcard] = []
    errors: List[str] = []

    for doc in docs:
        try:
            cards = await generate_flashcards(
                db, doc.id, course_id, per_doc_count, card_type, topic, guidance, language, difficulty, deck.id
            )
            all_cards.extend(cards)
        except Exception as e:
            errors.append(str(e)[:200])

    if not all_cards:
        await db.rollback()
        detail = "; ".join(errors) if errors else "No flashcards were generated."
        raise HTTPException(status_code=422, detail=detail)

    deck.card_count = len(all_cards)
    await db.flush()
    await db.refresh(deck)
    await db.commit()
    return deck


# ── List all cards (legacy/general) ──────────────────────────────────────────

@router.get("/", response_model=List[FlashcardOut])
async def list_flashcards(
    course_id: Optional[str] = None,
    due_only: bool = False,
    topic: Optional[str] = None,
    deck_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Flashcard).order_by(Flashcard.next_review_date)
    if course_id:
        query = query.where(Flashcard.course_id == course_id)
    if due_only:
        query = query.where(Flashcard.next_review_date <= date.today())
    if topic:
        query = query.where(Flashcard.topic == topic)
    if deck_id:
        query = query.where(Flashcard.deck_id == deck_id)
    result = await db.execute(query)
    return result.scalars().all()


# ── Review ────────────────────────────────────────────────────────────────────

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

    elapsed_days = 1
    if card.last_reviewed_at:
        delta = datetime.now(timezone.utc) - card.last_reviewed_at
        elapsed_days = max(1, delta.days)

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
