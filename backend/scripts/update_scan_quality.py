"""
Backfill scan_quality field in documents.metadata_ for all existing processed documents.

New documents automatically get scan_quality set during processing (via document_processor.py),
but documents processed before this feature was added have no scan_quality in their metadata.

scan_quality values:
  "good"    — extracted text contains Hebrew characters (successfully decoded)
  "partial" — no Hebrew but > 30 words (possibly English-only document)
  "poor"    — no Hebrew and <= 30 words (likely garbled / failed extraction)

Usage (from within the backend container):
    python -m scripts.update_scan_quality
"""
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.models.models import Document


def _has_hebrew(txt: str) -> bool:
    return any('\u05d0' <= c <= '\u05ea' for c in txt)


async def update_scan_quality() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Document).where(
                Document.processing_status == "done",
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()

    print(f"Found {len(docs)} processed documents to update.")

    counts = {"good": 0, "partial": 0, "poor": 0, "skipped": 0}

    async with AsyncSessionLocal() as db:
        for doc in docs:
            # Skip if already has scan_quality set
            if doc.metadata_ and "scan_quality" in doc.metadata_:
                counts["skipped"] += 1
                continue

            txt = doc.extracted_text or ""
            word_count = len(txt.split())
            has_hebrew = _has_hebrew(txt)
            scan_quality = "good" if has_hebrew else ("partial" if word_count > 30 else "poor")

            # Re-fetch in this session for ORM update
            result2 = await db.execute(select(Document).where(Document.id == doc.id))
            live_doc = result2.scalar_one_or_none()
            if not live_doc:
                continue

            # Merge into existing metadata_ (preserve word_count etc.)
            existing = dict(live_doc.metadata_) if live_doc.metadata_ else {}
            existing["scan_quality"] = scan_quality
            if "word_count" not in existing:
                existing["word_count"] = word_count

            live_doc.metadata_ = existing
            flag_modified(live_doc, "metadata_")
            counts[scan_quality] += 1

        await db.commit()

    print(f"\nResults:")
    print(f"  good:    {counts['good']} documents (Hebrew text confirmed)")
    print(f"  partial: {counts['partial']} documents (no Hebrew, but has content)")
    print(f"  poor:    {counts['poor']} documents (no Hebrew, very little content)")
    print(f"  skipped: {counts['skipped']} documents (already had scan_quality set)")
    print("\nDone. Refresh the Knowledge page to see the scan quality badges.")


if __name__ == "__main__":
    asyncio.run(update_scan_quality())
