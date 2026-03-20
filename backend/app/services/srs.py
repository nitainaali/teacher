"""
SRS Card Memory Scheduler
=========================
Wraps the FSRS-4.5 algorithm with a clean, single-entry-point interface used by the
session engine. All FSRS math is preserved from the original fsrs.py.

Grade mapping (internal): 1=Again, 2=Hard, 3=Good, 4=Easy
Frontend quality mapping:  0=Again → grade 1, 1=Hard → grade 2, 2=Good → grade 3, 3=Easy → grade 4

Architecture:
  - schedule_review(card, grade, now) → CardScheduleResult
  - CardScheduleResult carries all fields needed to update the Flashcard row + write a ReviewLog
"""
from __future__ import annotations
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple

from app.models.models import Flashcard


# ── FSRS-4.5 constants (trained on open-spaced-repetition dataset) ─────────────

# 17 default weights from the FSRS-4.5 paper
W = [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589,
    1.5330, 0.1544, 1.0070, 1.9395, 0.1100, 0.2900, 2.2700, 0.1450,
    2.9898, 0.5100, 0.0900,
]

DECAY = -0.5
FACTOR = 0.9 ** (1 / DECAY) - 1   # ≈ 19/81 ≈ 0.2346
REQUEST_RETENTION = 0.9            # target 90% retrieval probability

# Sub-day learning steps (minutes). Cards must pass all steps before graduating to long-term review.
LEARNING_STEPS_MINUTES: list[int] = [1, 10]


# ── FSRS core math ─────────────────────────────────────────────────────────────

def _forgetting_curve(elapsed_days: float, stability: float) -> float:
    """Retrievability R = (1 + FACTOR * t/S)^DECAY. Clamped to [0,1]."""
    if stability <= 0:
        return 0.0
    return max(0.0, min(1.0, (1 + FACTOR * elapsed_days / stability) ** DECAY))


def _stability_after_success(stability: float, difficulty: float, retrievability: float, grade: int) -> float:
    """Compute new stability after a successful review (grade 2/3/4)."""
    hard_penalty = W[15] if grade == 2 else 1.0
    easy_bonus   = W[16] if grade == 4 else 1.0
    return stability * (
        math.exp(W[8]) * (11 - difficulty)
        * pow(max(stability, 0.001), -W[9])
        * (math.exp((1 - retrievability) * W[10]) - 1)
        * hard_penalty
        * easy_bonus
        + 1
    )


def _stability_after_failure(stability: float, difficulty: float, retrievability: float) -> float:
    """Compute new stability after forgetting (grade=1/Again)."""
    return (
        W[11]
        * pow(max(difficulty, 0.001), -W[12])
        * (pow(max(stability + 1, 0.001), W[13]) - 1)
        * math.exp((1 - retrievability) * W[14])
    )


def _next_difficulty(difficulty: float, grade: int) -> float:
    """Update difficulty after a review (clamped to [1, 10])."""
    delta_d = -W[6] * (grade - 3)
    new_d = difficulty + delta_d * ((10 - difficulty) / 9)
    return max(1.0, min(10.0, new_d))


def _initial_stability(grade: int) -> float:
    """Stability for a brand-new card based on first grade (1-4)."""
    return max(W[max(1, min(4, grade)) - 1], 0.1)


def _initial_difficulty(grade: int) -> float:
    """Difficulty for a brand-new card (1-10 scale)."""
    return max(1.0, min(10.0, W[4] - W[5] * (grade - 3)))


MAX_INTERVAL_DAYS = 36500  # ~100 years — prevents timedelta overflow
INTERVAL_MULTIPLIER = 0.5  # shorten all FSRS review-state intervals


def _interval_from_stability(stability: float) -> int:
    """Convert stability S to next review interval in days."""
    raw = stability / FACTOR * (REQUEST_RETENTION ** (1 / DECAY) - 1)
    return min(MAX_INTERVAL_DAYS, max(1, round(raw)))


# ── Result type ────────────────────────────────────────────────────────────────

@dataclass
class CardScheduleResult:
    """
    All state changes produced by schedule_review().
    Used to update the Flashcard row and write a ReviewLog entry.
    """
    # Card memory state
    new_state: str              # new | learning | review | relearning
    new_stability: float
    new_difficulty: float
    new_retrievability: float   # R at the moment of review (before this review)
    # Scheduling
    interval_days: int
    next_review_date: date
    next_review_at: Optional[datetime]   # set for sub-day learning steps; None otherwise
    learning_step: Optional[int]
    # Counters
    new_review_count: int
    new_lapse_count: int
    new_last_rating: int
    # Audit info for ReviewLog
    elapsed_days: float
    previous_state: str
    previous_stability: float
    previous_difficulty: float


# ── Public entry point ─────────────────────────────────────────────────────────

def schedule_review(card: Flashcard, grade: int, now: Optional[datetime] = None) -> CardScheduleResult:
    """
    Compute the new schedule for a card given a rating.

    Args:
        card:  The Flashcard ORM object (read-only — caller applies the result).
        grade: 1=Again, 2=Hard, 3=Good, 4=Easy  (backend internal scale)
        now:   Timestamp to use as "now". Defaults to datetime.now(timezone.utc).

    Returns:
        CardScheduleResult with all fields needed to update the card + write a ReviewLog.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    grade = max(1, min(4, grade))  # clamp to valid range

    state    = card.fsrs_state or "new"
    stab     = card.stability or 0.0
    diff     = card.difficulty_fsrs or 0.3
    prev_due = card.next_review_date

    # ── Compute elapsed days since last review ──────────────────────────────
    elapsed_days = 0.0
    if card.last_reviewed_at:
        delta = now - card.last_reviewed_at
        elapsed_days = max(0.0, delta.total_seconds() / 86400)
    elif card.next_review_at:
        # Sub-day card being reviewed on time — treat as ~0 elapsed
        elapsed_days = 0.0

    # ── Compute current retrievability ─────────────────────────────────────
    retrievability = _forgetting_curve(elapsed_days, stab) if stab > 0 else 0.0

    # ── Route to the correct scheduler ─────────────────────────────────────
    if state in ("new", "learning"):
        result = _schedule_learning_step(card, grade, now, stab, diff)
    else:
        result = _schedule_review_card(stab, diff, state, grade, elapsed_days, now)

    # ── Lapse / review count updates ───────────────────────────────────────
    new_review_count = (card.review_count or 0) + 1
    # A lapse = Again on a card that was already in review/relearning
    is_lapse = (grade == 1) and (state in ("review", "relearning"))
    new_lapse_count = (card.lapse_count or 0) + (1 if is_lapse else 0)

    return CardScheduleResult(
        new_state=result["new_state"],
        new_stability=result["new_stability"],
        new_difficulty=result["new_difficulty"],
        new_retrievability=retrievability,
        interval_days=result["interval_days"],
        next_review_date=result["next_review_date"],
        next_review_at=result.get("next_review_at"),
        learning_step=result.get("learning_step"),
        new_review_count=new_review_count,
        new_lapse_count=new_lapse_count,
        new_last_rating=grade,
        elapsed_days=elapsed_days,
        previous_state=state,
        previous_stability=stab,
        previous_difficulty=diff,
    )


# ── Internal schedulers ────────────────────────────────────────────────────────

def _schedule_learning_step(
    card: Flashcard,
    grade: int,
    now: datetime,
    stab: float,
    diff: float,
) -> dict:
    """
    Handle learning/new cards that are still in sub-day learning steps.
    Learning steps: [1 min, 10 min] by default.

    Grade 1/2 → reset to step 0 (1 min)
    Grade 3   → advance to next step; if past last step → graduate to review
    Grade 4   → graduate immediately to review with FSRS interval
    """
    steps = LEARNING_STEPS_MINUTES
    current_step = card.learning_step  # None = hasn't started steps yet

    if grade == 4:
        # Easy — graduate immediately with fixed 1-day interval (not FSRS ~15d)
        grad_s = stab if stab > 0 else _initial_stability(4)
        grad_d = diff if diff > 0.5 else _initial_difficulty(4)
        return {
            "new_state": "review",
            "new_stability": grad_s,
            "new_difficulty": grad_d,
            "interval_days": 1,
            "next_review_date": date.today() + timedelta(days=1),
            "next_review_at": None,
            "learning_step": None,
        }

    if grade in (1, 2):
        # Again / Hard — go to step 0 (1 min)
        next_at = now + timedelta(minutes=steps[0])
        return {
            "new_state": "learning",
            "new_stability": stab,   # unchanged during steps
            "new_difficulty": diff,  # unchanged during steps
            "interval_days": 0,
            "next_review_date": date.today(),
            "next_review_at": next_at,
            "learning_step": 0,
        }

    # grade == 3 (Good) — advance to next step
    next_step = (current_step if current_step is not None else -1) + 1
    if next_step < len(steps):
        # Still in learning steps
        next_at = now + timedelta(minutes=steps[next_step])
        return {
            "new_state": "learning",
            "new_stability": stab,
            "new_difficulty": diff,
            "interval_days": 0,
            "next_review_date": date.today(),
            "next_review_at": next_at,
            "learning_step": next_step,
        }
    else:
        # Completed all steps → graduate to review with FSRS initial interval
        grad_s = stab if stab > 0 else _initial_stability(3)
        grad_d = diff if diff > 0.5 else _initial_difficulty(3)
        interval = _interval_from_stability(grad_s)
        return {
            "new_state": "review",
            "new_stability": grad_s,
            "new_difficulty": grad_d,
            "interval_days": interval,
            "next_review_date": date.today() + timedelta(days=interval),
            "next_review_at": None,
            "learning_step": None,
        }


def _schedule_review_card(
    stab: float,
    diff: float,
    state: str,
    grade: int,
    elapsed_days: float,
    now: datetime,
) -> dict:
    """
    Run full FSRS for a card in 'review' or 'relearning' state.

    If the card is brand-new (stability == 0) this also handles first reviews
    that somehow bypassed learning steps.
    """
    if stab <= 0:
        # First review (shouldn't normally reach here, but handle gracefully)
        new_s = _initial_stability(grade)
        new_d = _initial_difficulty(grade)
        if grade == 1:
            interval = 1
            new_state = "learning"
        else:
            interval = max(1, round(_interval_from_stability(new_s) * INTERVAL_MULTIPLIER))
            new_state = "review"
    else:
        retrievability = _forgetting_curve(elapsed_days, stab)
        new_d = _next_difficulty(diff if diff > 0 else 5.0, grade)

        if grade == 1:  # Again — forgot
            new_s = _stability_after_failure(stab, diff if diff > 0 else 5.0, retrievability)
            new_s = max(new_s, 0.1)
            new_state = "relearning"
            interval = 1
        else:
            new_s = _stability_after_success(stab, diff if diff > 0 else 5.0, retrievability, grade)
            new_s = max(new_s, 0.1)
            new_state = "review"
            interval = max(1, round(_interval_from_stability(new_s) * INTERVAL_MULTIPLIER))

    return {
        "new_state": new_state,
        "new_stability": new_s,
        "new_difficulty": new_d,
        "interval_days": interval,
        "next_review_date": date.today() + timedelta(days=interval),
        "next_review_at": None,
        "learning_step": None,
    }
