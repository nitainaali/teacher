"""
reset_broken_stability.py
=========================
One-time migration to fix flashcards that got astronomical stability values
due to the wrong FSRS-4.5 formula that was in use.

Background:
  The old `_stability_after_success` used `pow(10, W[8] * (11 - d))` instead of
  the correct `exp(W[8]) * (11 - d)`.  After a single review in "review" state
  this produced stability values of ~10^10 days (billions of years), causing:
    1. Nonsense intervals on the rating buttons (e.g. "286800238980d")
    2. Python timedelta overflow → 500 errors → UI freeze on card click

Fix:
  Cards with stability > 10,000 and fsrs_state in ('review', 'relearning') are
  reset to reasonable values so they reappear in the review queue:
    - stability       = 30.0   (≈ 1-month interval)
    - difficulty_fsrs = 5.0    (neutral difficulty)
    - next_review_date = today
    - next_review_at   = NULL
  fsrs_state is kept as "review" (not demoted to learning).

Usage (from within the backend container):
    python -m scripts.reset_broken_stability
"""
import asyncio
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.models import Flashcard

STABILITY_THRESHOLD = 20  # catches astronomical values AND the previously-wrong 30.0 reset
RESET_STABILITY = 3.0     # gives ~3 day "Good" intervals — close to W[2]=3.1262
RESET_DIFFICULTY = 5.0


async def main() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        # ── Find broken cards ──────────────────────────────────────────────
        result = await db.execute(
            select(Flashcard).where(
                Flashcard.stability > STABILITY_THRESHOLD,
                Flashcard.fsrs_state.in_(["review", "relearning"]),
            )
        )
        broken = result.scalars().all()

        if not broken:
            print("✅  No broken cards found — nothing to reset.")
            await engine.dispose()
            return

        print(f"Found {len(broken)} card(s) with stability > {STABILITY_THRESHOLD}:")
        for card in broken:
            print(
                f"  card {card.id[:8]}… | stability={card.stability:.1f}"
                f" | state={card.fsrs_state} | course={card.course_id[:8]}…"
            )

        # ── Reset them ────────────────────────────────────────────────────
        card_ids = [c.id for c in broken]
        await db.execute(
            update(Flashcard)
            .where(Flashcard.id.in_(card_ids))
            .values(
                stability=RESET_STABILITY,
                difficulty_fsrs=RESET_DIFFICULTY,
                next_review_date=date.today(),
                next_review_at=None,
            )
        )
        await db.commit()

    await engine.dispose()
    print(
        f"\n✅  Reset {len(broken)} card(s):"
        f"\n   stability       → {RESET_STABILITY}"
        f"\n   difficulty_fsrs → {RESET_DIFFICULTY}"
        f"\n   next_review_date → today ({date.today()})"
        f"\n   next_review_at   → NULL"
    )


if __name__ == "__main__":
    asyncio.run(main())
