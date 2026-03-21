"""
Processes documents uploaded to the shared knowledge library.
Thin wrapper around the existing document_processor logic that writes to
shared_documents / shared_document_chunks instead of the per-user tables.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import SharedDocument, SharedDocumentChunk
from app.services.embeddings import embed_texts, chunk_text
from app.services.document_processor import (
    _extract_text,
    _text_looks_valid,
    _claude_vision_extract,
    _pdf_to_base64_images,
)


async def process_shared_document(document_id: str, db: AsyncSession) -> None:
    """Process a shared document: extract text, chunk it, and embed chunks."""
    result = await db.execute(select(SharedDocument).where(SharedDocument.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        return

    doc.processing_status = "processing"
    await db.flush()

    try:
        # Extract text — same strategy as regular document processing
        text = await _extract_text(doc.file_path)

        if not _text_looks_valid(text):
            pages_b64 = _pdf_to_base64_images(doc.file_path)
            if pages_b64:
                text = await _claude_vision_extract(pages_b64)

        word_count = len(text.split()) if text else 0
        has_hebrew = any("\u0590" <= c <= "\u05ff" for c in (text or ""))
        if has_hebrew:
            scan_quality = "good"
        elif word_count > 30:
            scan_quality = "partial"
        else:
            scan_quality = "poor"
        doc.extracted_text = text
        doc.metadata_ = {"scan_quality": scan_quality, "word_count": word_count}

        # Chunk and embed
        if text and word_count > 10:
            chunks = chunk_text(text)
            embeddings = await embed_texts(chunks)
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                chunk_obj = SharedDocumentChunk(
                    shared_document_id=doc.id,
                    chunk_index=i,
                    content=chunk,
                    embedding=embedding,
                )
                db.add(chunk_obj)

        doc.processing_status = "done"
        await db.commit()

    except Exception as exc:
        doc.processing_status = "error"
        doc.metadata_ = {"error": str(exc)[:300]}
        await db.commit()
        raise
