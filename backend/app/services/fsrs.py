"""
FSRS-4.5 implementation with default weights.
Reference: https://github.com/open-spaced-repetition/fsrs4anki

Grade mapping: 1=Again, 2=Hard, 3=Good, 4=Easy
Frontend quality mapping: 0=Again → grade 1, 1=Hard → grade 2, 2=Good → grade 3, 3=Easy → grade 4
"""
from datetime import date, timedelta
from typing import Tuple

# Default FSRS-4.5 weights (17 parameters, trained on large open dataset)
W = [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589,
    1.5330, 0.1544, 1.0070, 1.9395, 0.1100, 0.2900, 2.2700, 0.1450,
    2.9898, 0.5100, 0.0900,
]

DECAY = -0.5
FACTOR = 0.9 ** (1 / DECAY) - 1
REQUEST_RETENTION = 0.9


def _forgetting_curve(elapsed_days: float, stability: float) -> float:
    """Calculate retrievability R given elapsed days t and stability S."""
    if stability <= 0:
        return 0.0
    return (1 + FACTOR * elapsed_days / stability) ** DECAY


def _stability_after_success(
    stability: float, difficulty: float, retrievability: float, grade: int
) -> float:
    """Compute new stability after a successful review (grade >= 2)."""
    hard_penalty = W[15] if grade == 2 else 1.0
    easy_bonus = W[16] if grade == 4 else 1.0
    return stability * (
        pow(10, W[8] * (11 - difficulty))
        * pow(max(retrievability, 0.001), -W[9])
        * (pow(W[10] + 1, W[11]) - 1)
        * hard_penalty
        * easy_bonus
        + 1
    )


def _stability_after_failure(
    stability: float, difficulty: float, retrievability: float
) -> float:
    """Compute new stability after forgetting (grade=1/Again)."""
    return (
        W[11]
        * pow(max(difficulty, 0.001), -W[12])
        * (pow(max(stability + 1, 0.001), W[13]) - 1)
        * pow(max(retrievability, 0.001), W[14])
    )


def _next_difficulty(difficulty: float, grade: int) -> float:
    """Update difficulty after a review."""
    delta_d = -W[6] * (grade - 3)
    new_d = difficulty + delta_d * ((10 - difficulty) / 9)
    return max(1.0, min(10.0, new_d))


def _initial_stability(grade: int) -> float:
    """Stability for a brand-new card based on first grade (1-4)."""
    grade = max(1, min(4, grade))
    return max(W[grade - 1], 0.1)


def _initial_difficulty(grade: int) -> float:
    """Difficulty for a brand-new card (1-10 scale)."""
    return max(1.0, min(10.0, W[4] - W[5] * (grade - 3)))


def _interval_from_stability(stability: float) -> int:
    """Compute next review interval (days) from stability."""
    interval = stability / FACTOR * (REQUEST_RETENTION ** (1 / DECAY) - 1)
    return max(1, round(interval))


def fsrs_next(
    stability: float,
    difficulty: float,
    fsrs_state: str,
    grade: int,
    elapsed_days: int = 1,
) -> Tuple[float, float, int, str, date]:
    """
    Compute next FSRS state after a review.

    Args:
        stability: current stability S (0 = new card)
        difficulty: current difficulty D (1-10, 0 = new card)
        fsrs_state: 'new' | 'learning' | 'review' | 'relearning'
        grade: 1=Again, 2=Hard, 3=Good, 4=Easy
        elapsed_days: days since last review (used for retrievability calc)

    Returns:
        (new_stability, new_difficulty, interval_days, new_state, next_review_date)
    """
    grade = max(1, min(4, grade))

    if fsrs_state == "new" or stability <= 0:
        # First review of a brand-new card
        new_s = _initial_stability(grade)
        new_d = _initial_difficulty(grade)
        if grade == 1:
            # Again on first review → short relearning step
            new_state = "learning"
            interval = 1
        else:
            new_state = "review"
            interval = _interval_from_stability(new_s)
    else:
        retrievability = _forgetting_curve(elapsed_days, stability)
        new_d = _next_difficulty(difficulty if difficulty > 0 else 5.0, grade)

        if grade == 1:  # Again — forgot
            new_s = _stability_after_failure(stability, difficulty if difficulty > 0 else 5.0, retrievability)
            new_s = max(new_s, 0.1)
            new_state = "relearning"
            interval = 1
        else:
            new_s = _stability_after_success(stability, difficulty if difficulty > 0 else 5.0, retrievability, grade)
            new_s = max(new_s, 0.1)
            new_state = "review"
            interval = _interval_from_stability(new_s)

    next_review = date.today() + timedelta(days=interval)
    return new_s, new_d, interval, new_state, next_review
