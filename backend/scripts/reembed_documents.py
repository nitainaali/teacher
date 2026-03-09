"""
Re-embed all processed documents using the current embedding model.

Run once after switching from all-MiniLM-L6-v2 to paraphrase-multilingual-MiniLM-L12-v2
so that existing document chunks are re-embedded with the new model and Hebrew content
is retrieved correctly by the RAG system.

Usage (from within the backend container):
    python -m scripts.reembed_documents
"""
import asyncio
import sys

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.models import Document, DocumentChunk
from app.services.embeddings import embed_texts, chunk_text


async def reembed_all() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        # Fetch all documents that have been processed and have text
        result = await db.execute(
            select(Document).where(
                Document.processing_status == "done",
                Document.extracted_text.isnot(None),
                Document.extracted_text != "",
            )
        )
        docs = result.scalars().all()

    print(f"Found {len(docs)} processed documents to re-embed.")

    if not docs:
        print("Nothing to do.")
        return

    async with AsyncSessionLocal() as db:
        for i, doc in enumerate(docs, 1):
            print(f"[{i}/{len(docs)}] {doc.original_name} ({doc.id})...", end=" ", flush=True)
            try:
                # Delete existing chunks for this document
                await db.execute(
                    delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
                )

                # Re-chunk and re-embed
                chunks = chunk_text(doc.extracted_text)
                if not chunks:
                    print("no chunks (empty text), skipped.")
                    continue

                embeddings = await embed_texts(chunks)
                for j, (content, embedding) in enumerate(zip(chunks, embeddings)):
                    db.add(DocumentChunk(
                        document_id=doc.id,
                        chunk_index=j,
                        content=content,
                        embedding=embedding,
                    ))

                await db.commit()
                print(f"OK ({len(chunks)} chunks)")

            except Exception as e:
                await db.rollback()
                print(f"ERROR: {e}")

    print("\nDone. All documents have been re-embedded with the multilingual model.")


if __name__ == "__main__":
    asyncio.run(reembed_all())
