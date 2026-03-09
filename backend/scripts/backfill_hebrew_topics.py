"""
Re-extract document_topic learning events in Hebrew.

Deletes all existing document_topic events (which were extracted with an English-only
prompt and are therefore in English), then re-runs _extract_document_topics() for every
processed knowledge document using the updated Hebrew prompt.

Usage (from within the backend container):
    python -m scripts.backfill_hebrew_topics
"""
import asyncio

from sqlalchemy import select, delete, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.models import Document, LearningEvent
from app.services.document_processor import _extract_document_topics


async def backfill_hebrew_topics() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Step 1: Delete all existing document_topic events
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(LearningEvent).where(LearningEvent.event_type == "document_topic")
        )
        deleted = result.rowcount
        await db.commit()
        print(f"Deleted {deleted} existing document_topic events.")

    # Step 2: Find all processed knowledge documents with text
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Document).where(
                Document.processing_status == "done",
                Document.upload_source == "knowledge",
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()

    print(f"Found {len(docs)} processed knowledge documents to re-extract topics from.")
    print()

    # Step 3: Re-extract topics in Hebrew for each document
    for i, doc in enumerate(docs, 1):
        print(f"[{i}/{len(docs)}] {doc.original_name!r}...", end=" ", flush=True)
        if not doc.extracted_text or not doc.extracted_text.strip():
            print("skipped (no text)")
            continue
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Document).where(Document.id == doc.id))
                live_doc = result.scalar_one_or_none()
                if not live_doc:
                    print("not found")
                    continue
                await _extract_document_topics(db, live_doc)
                # Count what was written
                from sqlalchemy import func
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

    print("\nDone. Refresh the Topic Summary page to see the new Hebrew topics.")


if __name__ == "__main__":
    asyncio.run(backfill_hebrew_topics())
