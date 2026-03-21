"""
One-time data migration: create the "ניתאי" user (admin) and backfill user_id
across all existing rows in the database.

Run AFTER: alembic upgrade o1_multi_user_schema
Run BEFORE: alembic upgrade o2_multi_user_constraints

Usage (from backend/ directory):
    python -m scripts.migrate_to_multi_user

This script is idempotent — safe to run multiple times.
"""
import asyncio
import sys
import os

# Ensure the backend package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update, text
from app.core.database import AsyncSessionLocal
from app.models.models import (
    User, Course, StudentProfile, LearningEvent,
    StudentPerformance, HomeworkSubmission, TopicSummary,
    StudySession, ReviewLog,
)

NITAI_USERNAME = "ניתאי"


async def run() -> None:
    async with AsyncSessionLocal() as db:
        # 1. Find or create the ניתאי user
        result = await db.execute(select(User).where(User.username == NITAI_USERNAME))
        nitai = result.scalar_one_or_none()

        if nitai is None:
            from app.models.models import gen_uuid
            nitai = User(
                id=gen_uuid(),
                username=NITAI_USERNAME,
                is_admin=True,
            )
            db.add(nitai)
            await db.flush()
            print(f"Created user '{NITAI_USERNAME}' with id={nitai.id}, is_admin=True")
        else:
            # Ensure admin flag is set
            nitai.is_admin = True
            await db.flush()
            print(f"Found existing user '{NITAI_USERNAME}' with id={nitai.id} — ensuring is_admin=True")

        uid = nitai.id

        # 2. Backfill all tables (UPDATE ... WHERE user_id IS NULL)
        tables = [
            (Course, "courses"),
            (StudentProfile, "student_profile"),
            (LearningEvent, "learning_events"),
            (StudentPerformance, "student_performance"),
            (HomeworkSubmission, "homework_submissions"),
            (TopicSummary, "topic_summaries"),
            (StudySession, "study_sessions"),
            (ReviewLog, "review_logs"),
        ]

        for model, table_name in tables:
            result = await db.execute(
                update(model)
                .where(model.user_id == None)  # noqa: E711
                .values(user_id=uid)
                .returning(text("id"))
            )
            count = len(result.fetchall())
            print(f"  {table_name}: updated {count} rows")

        await db.commit()
        print(f"\nMigration complete. All existing data is now owned by '{NITAI_USERNAME}' (id={uid}).")
        print("You can now run: alembic upgrade o2_multi_user_constraints")


if __name__ == "__main__":
    asyncio.run(run())
