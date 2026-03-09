"""
Backfill document_topic learning events for existing processed documents.

New documents automatically get topics extracted (via _extract_document_topics in
document_processor.py), but documents uploaded before this feature was added have
no document_topic events — so they don't appear in the Topic Summary left panel.

This script runs topic extraction for every processed knowledge document that has
no document_topic events yet.

Run AFTER reprocess_garbled.py so the re-processed docs already have good text.

Usage (from within the backend container):
    python -m scripts.backfill_document_topics
"""
import asyncio

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.models import Document, LearningEvent
from app.services.document_processor import _extract_document_topics


async def backfill_topics() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Find all processed knowledge documents
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Document).where(
                Document.processing_status == "done",
                Document.upload_source == "knowledge",
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()

    # Among those, find ones that have NO document_topic events at all
    to_backfill = []
    async with AsyncSessionLocal() as db:
        for doc in docs:
            count_result = await db.execute(
                select(func.count()).select_from(LearningEvent).where(
                    LearningEvent.event_type == "document_topic",
                    LearningEvent.details["document_id"].as_string() == doc.id,
                )
            )
            count = count_result.scalar() or 0
            if count == 0:
                to_backfill.append(doc)

    print(f"Found {len(docs)} processed knowledge documents.")
    print(f"  → {len(to_backfill)} need document_topic backfill.")

    if not to_backfill:
        print("Nothing to do.")
        return

    print()

    for i, doc in enumerate(to_backfill, 1):
        print(f"[{i}/{len(to_backfill)}] Extracting topics from {doc.original_name!r}...", end=" ", flush=True)
        if not doc.extracted_text or not doc.extracted_text.strip():
            print("skipped (no text)")
            continue
        try:
            async with AsyncSessionLocal() as db:
                # Re-fetch the doc in this session for proper ORM state
                result = await db.execute(select(Document).where(Document.id == doc.id))
                live_doc = result.scalar_one_or_none()
                if not live_doc:
                    print("not found")
                    continue
                await _extract_document_topics(db, live_doc)
                # Count what was written
                count_result = await db.execute(
                    select(func.count()).select_from(LearningEvent).where(
                        LearningEvent.event_type == "document_topic",
                        LearningEvent.details["document_id"].as_string() == doc.id,
                    )
                )
                written = count_result.scalar() or 0
                print(f"OK ({written} topics)")
        except Exception as e:
            print(f"ERROR: {e}")

    print("\nDone. Refresh the Topic Summary page to see the new topics.")


if __name__ == "__main__":
    asyncio.run(backfill_topics())
