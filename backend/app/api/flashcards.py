import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from typing import List, Optional
import math
from datetime import datetime, date, timezone

from app.core.database import get_db
from app.models.models import Flashcard, FlashcardDeck, Document, StudySession, ReviewLog, User
from app.schemas.schemas import (
    FlashcardOut, FlashcardReviewRequest, FlashcardDeckOut, FlashcardDeckRename,
    FlashcardUpdate, StudySessionCreate, StudySessionOut, NextCardResponse,
    SessionReviewRequest, SessionStats,
)
from app.services import flashcard_generator as fg
from app.services.srs import schedule_review
from app.services import session_policy, student_intelligence, claude
from app.api.deps import get_current_user

# Models for flashcard generation
FLASHCARD_MODEL = "claude-sonnet-4-6"
FLASHCARD_MODEL_EASY = "claude-sonnet-4-6"

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


# ── Deck endpoints ────────────────────────────────────────────────────────────

@router.get("/decks", response_model=List[FlashcardDeckOut])
async def list_decks(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FlashcardDeck)
        .where(FlashcardDeck.course_id == course_id)
        .order_by(FlashcardDeck.created_at.desc())
    )
    return result.scalars().all()


@router.get("/decks/{deck_id}/cards", response_model=List[FlashcardOut])
async def get_deck_cards(
    deck_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Flashcard).where(Flashcard.deck_id == deck_id).order_by(Flashcard.next_review_date)
    )
    return result.scalars().all()


@router.put("/decks/{deck_id}", response_model=FlashcardDeckOut)
async def rename_deck(
    deck_id: str,
    data: FlashcardDeckRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
async def delete_deck(
    deck_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(404, "Deck not found")
    await db.delete(deck)
    await db.commit()


@router.post("/decks/{deck_id}/reset", status_code=200)
async def reset_deck(
    deck_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reset SRS state for all cards in a deck back to 'new'.
    Preserves review_count, lapse_count, last_rating, first_seen_at (for student diagnosis).
    """
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(404, "Deck not found")

    await db.execute(
        update(Flashcard)
        .where(Flashcard.deck_id == deck_id)
        .values(
            fsrs_state="new",
            stability=0.0,
            difficulty_fsrs=0.0,
            next_review_date=date.today(),
            next_review_at=None,
            learning_step=None,
            interval_days=1,
        )
    )
    await db.commit()
    return {"status": "ok", "deck_id": deck_id}


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
    current_user: User = Depends(get_current_user),
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

    model = FLASHCARD_MODEL_EASY if difficulty == "easy" else FLASHCARD_MODEL
    system_prompt = await claude.build_system_prompt(db, course_id, language=language, user_id=current_user.id)

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

    results = await asyncio.gather(*tasks, return_exceptions=True)

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


# ── List all cards (legacy / general) ────────────────────────────────────────

@router.get("/", response_model=List[FlashcardOut])
async def list_flashcards(
    course_id: Optional[str] = None,
    due_only: bool = False,
    topic: Optional[str] = None,
    deck_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import or_, and_
    from datetime import date

    query = select(Flashcard).order_by(Flashcard.next_review_date)
    if course_id:
        query = query.where(Flashcard.course_id == course_id)
    if due_only:
        now = datetime.now(timezone.utc)
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
async def update_card(
    card_id: str,
    data: FlashcardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
async def delete_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")
    if card.deck_id:
        deck_result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == card.deck_id))
        deck = deck_result.scalar_one_or_none()
        if deck:
            deck.card_count = max(0, deck.card_count - 1)
    await db.delete(card)
    await db.commit()


# ── Legacy review endpoint (kept for backward compatibility) ──────────────────

@router.post("/{card_id}/review", response_model=FlashcardOut)
async def review_flashcard(
    card_id: str,
    data: FlashcardReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Legacy single-card review endpoint (no session tracking).
    Delegates to the SRS scheduler. Kept for backward compatibility.
    """
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")

    grade = data.quality + 1  # quality 0-3 → grade 1-4
    now = datetime.now(timezone.utc)
    sched = schedule_review(card, grade, now)
    if card.first_seen_at is None:
        card.first_seen_at = now
    _apply_schedule(card, sched, now)

    event_type = "flashcard_easy" if grade >= 3 else "flashcard_hard"
    await student_intelligence.write_learning_event(
        db=db,
        event_type=event_type,
        course_id=card.course_id,
        topic=card.topic,
        details={"grade": grade, "stability": round(card.stability or 0.0, 3), "interval": card.interval_days},
        user_id=current_user.id,
    )

    await db.flush()
    await db.refresh(card)
    await db.commit()
    return card


# ── Session endpoints ─────────────────────────────────────────────────────────

@router.post("/sessions", response_model=StudySessionOut)
async def create_session(
    data: StudySessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new study session.
    mode + intent together determine card selection policy and UX pacing.
    """
    valid_modes = {"ANKI_LIKE", "COVERAGE_FIRST", "HYBRID"}
    valid_intents = {"QUICK_REFRESH", "NORMAL_STUDY", "DEEP_MEMORIZATION"}
    valid_session_types = {"normal", "one_time_all", "one_time_learning"}

    if data.mode not in valid_modes:
        raise HTTPException(400, f"mode must be one of {valid_modes}")
    if data.intent not in valid_intents:
        raise HTTPException(400, f"intent must be one of {valid_intents}")
    if data.session_type not in valid_session_types:
        raise HTTPException(400, f"session_type must be one of {valid_session_types}")

    target_duration = session_policy.INTENT_TARGET_DURATION.get(data.intent, 30)

    sess = StudySession(
        course_id=data.course_id,
        deck_id=data.deck_id,
        topic_filter=data.topic_filter,
        mode=data.mode,
        intent=data.intent,
        session_type=data.session_type,
        target_duration_minutes=target_duration,
        card_exposures={},
        user_id=current_user.id,
    )
    db.add(sess)
    await db.flush()
    await db.refresh(sess)
    await db.commit()
    return sess


@router.get("/sessions/{session_id}/next", response_model=NextCardResponse)
async def get_next_card(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the next card to show in the session.
    Returns card=null when the session is complete (no more eligible cards).
    """
    sess_result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    sess = sess_result.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")
    if sess.ended_at is not None:
        raise HTTPException(400, "Session has already ended")

    next_card = await session_policy.get_next_card(sess, db)

    # Count total cards in scope for remaining estimate
    count_query = select(func.count(Flashcard.id))
    if sess.deck_id:
        count_query = count_query.where(Flashcard.deck_id == sess.deck_id)
    elif sess.topic_filter:
        count_query = count_query.where(
            Flashcard.course_id == sess.course_id,
            Flashcard.topic == sess.topic_filter,
        )
    else:
        count_query = count_query.where(Flashcard.course_id == sess.course_id)
    total_result = await db.execute(count_query)
    total_count = total_result.scalar_one()

    remaining = session_policy.estimate_remaining(sess, total_count)

    return NextCardResponse(
        card=next_card,
        cards_remaining_estimate=remaining,
        session_stats=SessionStats(
            cards_seen_count=sess.cards_seen_count,
            new_cards_seen_count=sess.new_cards_seen_count,
            review_cards_seen_count=sess.review_cards_seen_count,
            failed_cards_count=sess.failed_cards_count,
        ),
    )


@router.post("/sessions/{session_id}/review", response_model=FlashcardOut)
async def session_review_card(
    session_id: str,
    data: SessionReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a card review during a session.
    Updates card memory state, writes ReviewLog, updates session counters.
    """
    sess_result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    sess = sess_result.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")
    if sess.ended_at is not None:
        raise HTTPException(400, "Session has already ended")

    card_result = await db.execute(select(Flashcard).where(Flashcard.id == data.card_id))
    card = card_result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Flashcard not found")

    grade = data.quality + 1  # quality 0-3 → grade 1-4
    now = datetime.now(timezone.utc)
    is_one_time = sess.session_type in ("one_time_all", "one_time_learning")

    # Track whether this was a new card before scheduling
    is_new = card.fsrs_state == "new" or (card.review_count or 0) == 0

    # Compute schedule (for preview intervals in response)
    sched = schedule_review(card, grade, now)

    if not is_one_time:
        # Normal session: persist all state changes
        if card.first_seen_at is None:
            card.first_seen_at = now

        prev_due = card.next_review_date
        _apply_schedule(card, sched, now)

        # ── Write ReviewLog ────────────────────────────────────────────────
        log = ReviewLog(
            session_id=session_id,
            card_id=card.id,
            course_id=card.course_id,
            rating=grade,
            previous_state=sched.previous_state,
            new_state=sched.new_state,
            previous_stability=sched.previous_stability,
            new_stability=sched.new_stability,
            previous_difficulty=sched.previous_difficulty,
            new_difficulty=sched.new_difficulty,
            previous_due_date=prev_due,
            new_due_date=card.next_review_date,
            elapsed_days=sched.elapsed_days,
            mode_used=sess.mode,
            user_id=current_user.id,
        )
        db.add(log)

    # ── Update session state (always tracked for progress display) ─────────
    exposures: dict = dict(sess.card_exposures or {})
    exposures[card.id] = exposures.get(card.id, 0) + 1
    sess.card_exposures = exposures
    sess.last_card_id = card.id
    sess.cards_seen_count = (sess.cards_seen_count or 0) + 1
    if is_new:
        sess.new_cards_seen_count = (sess.new_cards_seen_count or 0) + 1
    else:
        sess.review_cards_seen_count = (sess.review_cards_seen_count or 0) + 1
    if grade == 1:
        sess.failed_cards_count = (sess.failed_cards_count or 0) + 1

    if not is_one_time:
        # ── Learning event (keeps recommendation engine working) ───────────
        event_type = "flashcard_easy" if grade >= 3 else "flashcard_hard"
        await student_intelligence.write_learning_event(
            db=db,
            event_type=event_type,
            course_id=card.course_id,
            topic=card.topic,
            details={"grade": grade, "stability": round(card.stability or 0.0, 3), "interval": card.interval_days},
            user_id=current_user.id,
        )

    # For one-time sessions: temporarily apply schedule to card object for the response,
    # but only flush the session counters (card state reverts on rollback is fine — we commit)
    if is_one_time:
        # Apply schedule temporarily so response shows correct interval preview
        _apply_schedule(card, sched, now)
        await db.flush()
        await db.refresh(card)
        # Rollback card changes — revert card to original state
        await db.rollback()
        # Re-apply session counter update (session was rolled back too, re-fetch and update)
        sess_result2 = await db.execute(select(StudySession).where(StudySession.id == session_id))
        sess2 = sess_result2.scalar_one_or_none()
        if sess2:
            exposures2: dict = dict(sess2.card_exposures or {})
            exposures2[card.id] = exposures2.get(card.id, 0) + 1
            sess2.card_exposures = exposures2
            sess2.last_card_id = card.id
            sess2.cards_seen_count = (sess2.cards_seen_count or 0) + 1
            if is_new:
                sess2.new_cards_seen_count = (sess2.new_cards_seen_count or 0) + 1
            else:
                sess2.review_cards_seen_count = (sess2.review_cards_seen_count or 0) + 1
            if grade == 1:
                sess2.failed_cards_count = (sess2.failed_cards_count or 0) + 1
            await db.flush()
            await db.commit()
        # Re-fetch card in original state for response
        card_result2 = await db.execute(select(Flashcard).where(Flashcard.id == data.card_id))
        card = card_result2.scalar_one()
        # Compute schedule again and apply temporarily to preview
        sched2 = schedule_review(card, grade, now)
        _apply_schedule(card, sched2, now)
        return card

    await db.flush()
    await db.refresh(card)
    await db.commit()
    return card


@router.post("/sessions/{session_id}/end", response_model=StudySessionOut)
async def end_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a session as ended and return final stats."""
    sess_result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    sess = sess_result.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")

    if sess.ended_at is None:
        sess.ended_at = datetime.now(timezone.utc)

        # ── Write per-topic completion events (normal sessions only) ──────────
        # Rating → score mapping: Again=0.0, Hard=0.5, Good=1.0, Easy=1.0
        RATING_SCORE = {1: 0.0, 2: 0.5, 3: 1.0, 4: 1.0}
        is_one_time = sess.session_type in ("one_time_all", "one_time_learning")
        if not is_one_time and sess.card_exposures:
            try:
                review_result = await db.execute(
                    select(ReviewLog, Flashcard)
                    .join(Flashcard, ReviewLog.card_id == Flashcard.id)
                    .where(ReviewLog.session_id == session_id)
                )
                topic_ratings: dict[str, list[float]] = {}
                for log, card in review_result.all():
                    topic = card.topic or "כללי"
                    topic_ratings.setdefault(topic, []).append(
                        RATING_SCORE.get(log.rating, 0.5)
                    )
                for topic, scores in topic_ratings.items():
                    avg = round(sum(scores) / len(scores), 3)
                    await student_intelligence.write_learning_event(
                        db=db,
                        event_type="flashcard_session_complete",
                        course_id=sess.course_id,
                        topic=topic,
                        details={"score": avg, "cards_reviewed": len(scores)},
                        user_id=current_user.id,
                    )
            except Exception:
                pass  # never block session end on event-writing failure

        await db.flush()
        await db.refresh(sess)
        await db.commit()
    return sess


# ── Internal helpers ──────────────────────────────────────────────────────────

def _apply_schedule(card: Flashcard, sched, now: datetime) -> None:
    """Apply a CardScheduleResult to a Flashcard ORM object (in-place)."""
    card.fsrs_state = sched.new_state
    card.stability = sched.new_stability
    card.difficulty_fsrs = sched.new_difficulty
    card.retrievability_estimate = sched.new_retrievability
    card.interval_days = sched.interval_days
    card.next_review_date = sched.next_review_date
    card.next_review_at = sched.next_review_at
    card.learning_step = sched.learning_step
    card.last_reviewed_at = now
    card.review_count = sched.new_review_count
    card.lapse_count = sched.new_lapse_count
    card.last_rating = sched.new_last_rating
