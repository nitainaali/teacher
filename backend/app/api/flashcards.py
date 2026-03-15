import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from typing import List, Optional
import math
from datetime import date, datetime, timezone

from app.core.database import get_db
from app.models.models import Flashcard, FlashcardDeck, Document
from app.schemas.schemas import FlashcardOut, FlashcardReviewRequest, FlashcardDeckOut, FlashcardDeckRename, FlashcardUpdate
from app.services import flashcard_generator as fg
from app.services.fsrs import fsrs_next, fsrs_learning_step
from app.services import student_intelligence, claude

# Models for flashcard generation
FLASHCARD_MODEL = "claude-sonnet-4-6"
FLASHCARD_MODEL_EASY = "claude-sonnet-4-6"

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

    # ── Parallel generation ────────────────────────────────────────────────────
    per_doc_count = max(5, math.ceil(count / len(docs)))
    all_cards: List[Flashcard] = []
    errors: List[str] = []

    # Choose model based on difficulty (Haiku for easy = ~10× faster)
    model = FLASHCARD_MODEL_EASY if difficulty == "easy" else FLASHCARD_MODEL

    # Build system prompt once (single DB call) so parallel tasks share no DB session
    system_prompt = await claude.build_system_prompt(db, course_id, language=language)

    # Build tasks — pure prompt building, no DB access
    task_docs: List[Document] = []
    tasks = []
    for doc in docs:
        if not doc.extracted_text:
            errors.append(f"Document '{doc.original_name}' has no extracted text. Skipped.")
            continue
        max_tokens = max(per_doc_count * 220, 800)
        prompt = fg.build_flashcard_prompt(
            doc.extracted_text, per_doc_count, card_type, difficulty, topic, guidance
        )
        tasks.append(
            claude.complete_with_system(
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                model=model,
            )
        )
        task_docs.append(doc)

    # Run all Claude API calls in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Parse results and save to DB sequentially (safe for SQLAlchemy session)
    for doc, result in zip(task_docs, results):
        if isinstance(result, Exception):
            errors.append(f"[{doc.original_name}] {str(result)[:200]}")
            continue
        try:
            cards_data = fg._parse_json_array(result)
            for item in cards_data:
                front = item.get("front", "").strip()
                back = item.get("back", "").strip()
                if not front or not back:
                    continue
                card = Flashcard(
                    course_id=course_id,
                    source_document_id=doc.id,
                    deck_id=deck.id,
                    front=front,
                    back=back,
                    topic=item.get("topic"),
                )
                db.add(card)
                all_cards.append(card)
        except Exception as e:
            errors.append(f"[{doc.original_name}] {str(e)[:200]}")

    await db.flush()

    # Trim excess cards to match requested count exactly
    if len(all_cards) > count:
        for card in all_cards[count:]:
            await db.delete(card)
        all_cards = all_cards[:count]

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
        now = datetime.now(timezone.utc)
        # Cards are due if:
        # - they have a sub-day next_review_at that is now past, OR
        # - they have no sub-day time and their next_review_date is today or past
        query = query.where(
            or_(
                and_(Flashcard.next_review_at.isnot(None), Flashcard.next_review_at <= now),
                and_(Flashcard.next_review_at.is_(None), Flashcard.next_review_date <= date.today()),
            )
        )
    if topic:
        query = query.where(Flashcard.topic == topic)
    if deck_id:
        query = query.where(Flashcard.deck_id == deck_id)
    result = await db.execute(query)
    return result.scalars().all()


# ── Individual card edit / delete ─────────────────────────────────────────────

@router.put("/{card_id}", response_model=FlashcardOut)
async def update_card(card_id: str, data: FlashcardUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")
    if data.front is not None:
        card.front = data.front.strip()
    if data.back is not None:
        card.back = data.back.strip()
    await db.flush()
    await db.refresh(card)
    await db.commit()
    return card


@router.delete("/{card_id}", status_code=204)
async def delete_card(card_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")
    # Decrement deck card count
    if card.deck_id:
        deck_result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == card.deck_id))
        deck = deck_result.scalar_one_or_none()
        if deck:
            deck.card_count = max(0, deck.card_count - 1)
    await db.delete(card)
    await db.commit()


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

    fsrs_grade = data.quality + 1  # quality 0-3 → grade 1-4

    if card.fsrs_state in ("new", "learning"):
        # Use learning steps logic (sub-day intervals)
        new_step, new_state, next_at, next_date, interval = fsrs_learning_step(
            current_step=card.learning_step,
            fsrs_state=card.fsrs_state or "new",
            stability=card.stability or 0.0,
            difficulty=card.difficulty_fsrs or 0.3,
            grade=fsrs_grade,
        )
        card.learning_step = new_step
        card.fsrs_state = new_state
        card.next_review_at = next_at
        card.next_review_date = next_date or date.today()
        card.interval_days = interval
        card.last_reviewed_at = datetime.now(timezone.utc)
        # Keep stability/difficulty unchanged during learning steps (FSRS takes over at graduation)
        new_s = card.stability or 0.0
        new_d = card.difficulty_fsrs or 0.3

    else:
        # Review / relearning: use full FSRS algorithm
        elapsed_days = 1
        if card.last_reviewed_at:
            delta = datetime.now(timezone.utc) - card.last_reviewed_at
            elapsed_days = max(1, delta.days)

        new_s, new_d, interval, new_state, next_date = fsrs_next(
            stability=card.stability or 0.0,
            difficulty=card.difficulty_fsrs or 0.3,
            fsrs_state=card.fsrs_state or "review",
            grade=fsrs_grade,
            elapsed_days=elapsed_days,
        )
        card.stability = new_s
        card.difficulty_fsrs = new_d
        card.fsrs_state = new_state
        card.interval_days = interval
        card.next_review_date = next_date
        card.next_review_at = None      # clear sub-day time when in review
        card.learning_step = None       # clear step when in review
        card.last_reviewed_at = datetime.now(timezone.utc)

    event_type = "flashcard_easy" if fsrs_grade >= 3 else "flashcard_hard"
    await student_intelligence.write_learning_event(
        db=db,
        event_type=event_type,
        course_id=card.course_id,
        topic=card.topic,
        details={"grade": fsrs_grade, "stability": round(card.stability or 0.0, 3), "interval": card.interval_days},
    )

    await db.flush()
    await db.refresh(card)
    await db.commit()
    return card
