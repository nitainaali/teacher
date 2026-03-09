"""
Detect and re-process documents whose extracted text is garbled
(no Hebrew characters despite being Hebrew course materials).

This fixes PDFs where pypdf returned > 50 junk words (e.g. "Ino4: +% - IN art-")
so Claude Vision was never invoked. After running this script those documents will
be re-processed with the improved heuristic, receiving correct Hebrew text.

After this script, run backfill_document_topics.py to extract topics from them.

Usage (from within the backend container):
    python -m scripts.reprocess_garbled
"""
import asyncio

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.models import Document, DocumentChunk
from app.services.document_processor import process_document


def _has_hebrew(text: str) -> bool:
    return any('\u05d0' <= c <= '\u05ea' for c in text)


async def reprocess_garbled() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Document).where(
                Document.processing_status == "done",
                Document.upload_source == "knowledge",
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()

    # Find garbled: extracted_text has content but zero Hebrew characters
    garbled = [
        doc for doc in docs
        if doc.extracted_text and len(doc.extracted_text.strip()) > 0
        and not _has_hebrew(doc.extracted_text)
    ]

    print(f"Found {len(garbled)} garbled document(s) (no Hebrew in extracted text).")
    if not garbled:
        print("Nothing to re-process.")
        return

    for doc in garbled:
        preview = doc.extracted_text[:80].replace("\n", " ")
        print(f"  ⚠  {doc.original_name!r}  — text preview: {preview!r}")

    print()

    for i, doc in enumerate(garbled, 1):
        print(f"[{i}/{len(garbled)}] Re-processing {doc.original_name!r} ({doc.id})...")

        # Reset status so process_document runs the full pipeline again
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Document).where(Document.id == doc.id))
            live_doc = result.scalar_one_or_none()
            if not live_doc:
                print("  → Document not found, skipped.")
                continue

            # Clear old chunks and reset status
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
            live_doc.processing_status = "pending"
            live_doc.extracted_text = None
            await db.commit()

        # Re-process in a fresh session (same as normal upload flow)
        async with AsyncSessionLocal() as db:
            try:
                await process_document(doc.id, db)
                # Check result
                result = await db.execute(select(Document).where(Document.id == doc.id))
                updated = result.scalar_one_or_none()
                if updated and updated.processing_status == "done":
                    if updated.extracted_text and _has_hebrew(updated.extracted_text):
                        print(f"  ✓  Now has Hebrew text ({len(updated.extracted_text)} chars)")
                    else:
                        print(f"  ⚠  Processed but still no Hebrew — check PDF quality")
                else:
                    status = updated.processing_status if updated else "not found"
                    print(f"  ✗  Status: {status}")
            except Exception as e:
                print(f"  ✗  Error: {e}")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(reprocess_garbled())
