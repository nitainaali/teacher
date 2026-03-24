"""
Session Policy Engine
=====================
Decides WHICH card to show next during a study session.
This is separate from the Card Memory Scheduler (srs.py), which decides WHEN a card is due.

Three study modes:
  - ANKI_LIKE:      Prioritize due/weak/failed cards. Allow repeated exposure to failed cards.
  - COVERAGE_FIRST: Prioritize broad coverage of unseen cards. Cap repeat exposures aggressively.
  - HYBRID:         (Default) Mix new cards with reinforcement of weak cards.

Three session intent presets that modify aggressiveness:
  - QUICK_REFRESH:      More new cards, less re-drilling of weak cards. (~20 min)
  - NORMAL_STUDY:       Balanced defaults. (~30 min)
  - DEEP_MEMORIZATION:  More weak card repetition, higher overall engagement. (~45 min)

Priority scoring formula:
  score = urgency_w * urgency
        + weakness_w * weakness
        + novelty_w  * novelty
        + balance_w  * balance
        - rep_penalty  * exposures_this_session
        - imm_penalty  * (1 if last card)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_

from app.models.models import Flashcard, StudySession


# ── Mode / intent configuration ────────────────────────────────────────────────

@dataclass
class ModeConfig:
    """
    Weight parameters for the priority scoring formula.
    All weights are positive floats; penalties are subtracted.
    """
    urgency_weight: float           # how overdue / how close to due date
    weakness_weight: float          # lapse count, low stability, recent failures
    novelty_weight: float           # boost for new/unseen cards
    balance_weight: float           # prevents getting stuck in only one category
    repetition_penalty: float       # per-exposure penalty for cards seen this session
    immediate_repeat_penalty: float # extra penalty if this card was the very last one shown
    max_exposures_per_session: int  # hard cap — card is excluded beyond this
    weak_card_reinject_gap: int     # in COVERAGE_FIRST: show N new cards before a weak card can come back


MODE_CONFIGS: dict[str, ModeConfig] = {
    # ANKI_LIKE: classic spaced-repetition behaviour.
    # Prioritizes due cards and failures. Failed cards can return often.
    "ANKI_LIKE": ModeConfig(
        urgency_weight=0.40,
        weakness_weight=0.35,
        novelty_weight=0.10,
        balance_weight=0.10,
        repetition_penalty=0.15,
        immediate_repeat_penalty=0.30,
        max_exposures_per_session=5,
        weak_card_reinject_gap=2,
    ),
    # COVERAGE_FIRST: maximize unique cards seen in one session.
    # New/unseen cards are king. Weak cards are deferred until after a broad first pass.
    "COVERAGE_FIRST": ModeConfig(
        urgency_weight=0.10,
        weakness_weight=0.10,
        novelty_weight=0.60,
        balance_weight=0.15,
        repetition_penalty=0.40,
        immediate_repeat_penalty=0.50,
        max_exposures_per_session=2,
        weak_card_reinject_gap=6,
    ),
    # HYBRID: default. Mix of new card progress and retention work.
    # Ensures students see variety and don't feel stuck.
    "HYBRID": ModeConfig(
        urgency_weight=0.25,
        weakness_weight=0.25,
        novelty_weight=0.30,
        balance_weight=0.15,
        repetition_penalty=0.25,
        immediate_repeat_penalty=0.40,
        max_exposures_per_session=3,
        weak_card_reinject_gap=4,
    ),
}

# Intent modifiers: additive adjustments applied on top of the base ModeConfig weights.
# Keys match weight field names; "max_exposures" adjusts max_exposures_per_session.
INTENT_MODIFIERS: dict[str, dict] = {
    "QUICK_REFRESH": {
        "novelty_weight": +0.15,
        "weakness_weight": -0.10,
        "max_exposures": -1,
    },
    "NORMAL_STUDY": {},  # no adjustments — use ModeConfig as-is
    "DEEP_MEMORIZATION": {
        "weakness_weight": +0.15,
        "urgency_weight": +0.10,
        "max_exposures": +1,
    },
}

# Target session duration by intent (minutes) — used for UX display only
INTENT_TARGET_DURATION: dict[str, int] = {
    "QUICK_REFRESH": 20,
    "NORMAL_STUDY": 30,
    "DEEP_MEMORIZATION": 45,
}


def get_config(mode: str, intent: str) -> ModeConfig:
    """Return a ModeConfig with intent modifiers applied (creates a copy)."""
    base = MODE_CONFIGS.get(mode, MODE_CONFIGS["HYBRID"])
    mods = INTENT_MODIFIERS.get(intent, {})
    if not mods:
        return base

    # Apply intent modifiers to create a tuned config
    return ModeConfig(
        urgency_weight=max(0.0, base.urgency_weight + mods.get("urgency_weight", 0.0)),
        weakness_weight=max(0.0, base.weakness_weight + mods.get("weakness_weight", 0.0)),
        novelty_weight=max(0.0, base.novelty_weight + mods.get("novelty_weight", 0.0)),
        balance_weight=base.balance_weight,
        repetition_penalty=base.repetition_penalty,
        immediate_repeat_penalty=base.immediate_repeat_penalty,
        max_exposures_per_session=max(1, base.max_exposures_per_session + mods.get("max_exposures", 0)),
        weak_card_reinject_gap=base.weak_card_reinject_gap,
    )


# ── Scoring functions ──────────────────────────────────────────────────────────

def _urgency_score(card: Flashcard, now: datetime) -> float:
    """
    How overdue is this card?
    - 0.0  → card is not due yet
    - 0.5  → card is due today
    - 1.0  → card is 1 interval past due (or more)
    """
    # Use next_review_at for sub-day cards
    if card.next_review_at is not None:
        overdue_minutes = (now - card.next_review_at).total_seconds() / 60
        if overdue_minutes < 0:
            return 0.0  # not due yet
        # Cap at 1.0 after 30 minutes overdue (within learning steps)
        return min(1.0, overdue_minutes / 30.0)

    # Day-level scheduling
    today = now.date()
    due_date = card.next_review_date
    if due_date is None:
        return 0.5  # assume due if unknown

    days_overdue = (today - due_date).days
    if days_overdue < 0:
        return 0.0  # not due
    if days_overdue == 0:
        return 0.5  # due today
    # Logarithmic scale: 1 day overdue → 0.7, 3 days → 0.9, 7+ days → ~1.0
    return min(1.0, 0.5 + 0.5 * math.log1p(days_overdue) / math.log1p(7))


def _weakness_score(card: Flashcard) -> float:
    """
    How weak is this card in the student's memory?
    Considers: lapse count, low stability, recent failure rating.
    Returns 0.0 (strong) to 1.0 (very weak).
    """
    score = 0.0

    # Lapses are the strongest signal of weakness
    lapses = card.lapse_count or 0
    if lapses > 0:
        # 1 lapse → +0.4, 2 lapses → +0.6, 3+ → +0.8
        score += min(0.8, 0.3 + 0.15 * lapses)

    # Low stability relative to what we'd expect
    stab = card.stability or 0.0
    if stab > 0:
        # Stability < 3 days → weak, > 30 days → strong
        weakness_from_stab = max(0.0, 1.0 - math.log1p(stab) / math.log1p(30))
        score += 0.3 * weakness_from_stab

    # Last rating was Again or Hard
    last_rating = card.last_rating
    if last_rating == 1:   # Again
        score += 0.25
    elif last_rating == 2:  # Hard
        score += 0.10

    return min(1.0, score)


def _novelty_score(card: Flashcard) -> float:
    """
    How new / unseen is this card?
    - 1.0 → brand-new card (never reviewed)
    - 0.5 → first seen recently
    - 0.0 → reviewed many times before
    """
    if card.fsrs_state == "new" or card.first_seen_at is None:
        return 1.0  # completely unseen
    if card.review_count == 0:
        return 1.0

    # Decay novelty score as review_count increases
    # review_count 1 → 0.7, 5 → 0.3, 10+ → ~0.1
    return max(0.05, 1.0 - math.log1p(card.review_count or 0) / math.log1p(10))


def _balance_score(session: StudySession, card: Flashcard) -> float:
    """
    Session balance nudge: if the session has been all-new or all-review,
    lightly push toward the under-represented category.
    Returns -0.2 to +0.2.
    """
    seen = session.cards_seen_count or 1
    new_ratio = (session.new_cards_seen_count or 0) / seen

    is_new = card.fsrs_state == "new" or (card.review_count or 0) == 0

    if new_ratio > 0.8 and not is_new:
        # Session is heavily new-card biased — slightly boost review cards
        return 0.2
    if new_ratio < 0.2 and is_new:
        # Session is heavily review biased — slightly boost new cards
        return 0.2
    return 0.0


def _score_card(
    card: Flashcard,
    session: StudySession,
    config: ModeConfig,
    now: datetime,
) -> float:
    """
    Compute the selection priority score for a single candidate card.
    Higher score = show this card sooner.
    """
    card_id = card.id
    exposures = (session.card_exposures or {}).get(card_id, 0)

    urgency  = _urgency_score(card, now)
    weakness = _weakness_score(card)
    novelty  = _novelty_score(card)
    balance  = _balance_score(session, card)

    # Penalty for cards seen many times this session
    rep_pen = exposures * config.repetition_penalty

    # Extra penalty for showing the exact same card twice in a row
    imm_pen = config.immediate_repeat_penalty if card_id == session.last_card_id else 0.0

    score = (
        config.urgency_weight  * urgency
      + config.weakness_weight * weakness
      + config.novelty_weight  * novelty
      + config.balance_weight  * balance
      - rep_pen
      - imm_pen
    )
    return score


# ── Public API ─────────────────────────────────────────────────────────────────

async def get_next_card(session: StudySession, db: AsyncSession) -> Optional[Flashcard]:
    """
    Select the next card to show in the current study session.

    Returns None when no eligible cards remain (session is complete).

    Selection algorithm:
    1. Build candidate pool: cards in the session's deck/topic/course scope
    2. Exclude cards that have hit the max_exposures_per_session cap
    3. For COVERAGE_FIRST: if there are unseen cards, exclude weak cards
       until at least weak_card_reinject_gap new cards have been seen
    4. Score all remaining candidates
    5. Return the highest-scoring card
    """
    from dataclasses import replace as dc_replace
    now = datetime.now(timezone.utc)
    config = get_config(session.mode, session.intent)
    # One-time sessions show each card exactly once
    if session.session_type in ("one_time_all", "one_time_learning"):
        config = dc_replace(config, max_exposures_per_session=1)
    exposures: dict[str, int] = session.card_exposures or {}

    # ── Build candidate query ──────────────────────────────────────────────
    query = select(Flashcard)

    if session.deck_id:
        query = query.where(Flashcard.deck_id == session.deck_id)
    elif session.topic_filter:
        query = query.where(
            Flashcard.course_id == session.course_id,
            Flashcard.topic == session.topic_filter,
        )
    else:
        query = query.where(Flashcard.course_id == session.course_id)

    result = await db.execute(query)
    all_cards: List[Flashcard] = result.scalars().all()

    if not all_cards:
        return None

    # ── Filter: exclude cards over the exposure cap ────────────────────────
    candidates = [
        c for c in all_cards
        if exposures.get(c.id, 0) < config.max_exposures_per_session
    ]

    if not candidates:
        return None

    # ── One-time learning: restrict to cards still in learning steps ────────
    if session.session_type == "one_time_learning":
        learning_candidates = [c for c in candidates if c.fsrs_state == "learning"]
        if not learning_candidates:
            return None
        candidates = learning_candidates

    # ── COVERAGE_FIRST: defer weak cards until enough new ones have been seen ─
    if session.mode == "COVERAGE_FIRST":
        unseen = [c for c in candidates if c.fsrs_state == "new" or (c.review_count or 0) == 0]
        if unseen:
            # Count new cards shown in this session so far
            new_seen = session.new_cards_seen_count or 0
            # Only allow weak/reviewed cards if enough new ones have been shown
            weak_eligible = new_seen >= config.weak_card_reinject_gap
            if not weak_eligible:
                # Restrict pool to new/unseen cards only
                candidates = unseen if unseen else candidates

    # ── Score all candidates and return the winner ─────────────────────────
    scored = [(c, _score_card(c, session, config, now)) for c in candidates]
    scored.sort(key=lambda x: x[1], reverse=True)

    return scored[0][0]


def estimate_remaining(session: StudySession, total_cards: int) -> int:
    """
    Rough estimate of cards remaining in the session.
    Used for UX display only — intentionally approximate.
    """
    config = get_config(session.mode, session.intent)
    exposures = session.card_exposures or {}

    # Cards that still have remaining capacity
    remaining = sum(
        1 for card_id, count in exposures.items()
        if count < config.max_exposures_per_session
    )
    # Cards not yet seen at all
    unseen = max(0, total_cards - len(exposures))
    return unseen + remaining
