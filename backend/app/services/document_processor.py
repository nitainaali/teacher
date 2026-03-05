import base64
import io
import os
from pathlib import Path
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import anthropic

from app.core.config import settings
from app.models.models import Document, DocumentChunk
from app.services.embeddings import embed_texts, chunk_text


async def process_document(document_id: str, db: AsyncSession) -> None:
    """Full pipeline: PDF → text (via pypdf + Claude Vision fallback) → chunks → embeddings."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        return

    doc.processing_status = "processing"
    await db.commit()

    try:
        extracted_text = await _extract_text(doc.file_path)
        doc.extracted_text = extracted_text
        doc.metadata_ = {"word_count": len(extracted_text.split())}

        # Chunk and embed
        chunks = chunk_text(extracted_text)
        if chunks:
            embeddings = await embed_texts(chunks)
            for i, (content, embedding) in enumerate(zip(chunks, embeddings)):
                chunk = DocumentChunk(
                    document_id=document_id,
                    chunk_index=i,
                    content=content,
                    embedding=embedding,
                )
                db.add(chunk)

        doc.processing_status = "done"
        await db.commit()

    except Exception as e:
        doc.processing_status = "error"
        doc.metadata_ = {"error": str(e)}
        await db.commit()


async def _extract_text(file_path: str) -> str:
    """
    Try pypdf text extraction first. If text is sparse (scanned/handwritten),
    fall back to Claude Vision via pymupdf-rendered page images.
    """
    loop = asyncio.get_event_loop()

    # Attempt text extraction via pypdf
    text = await loop.run_in_executor(None, _pypdf_extract, file_path)
    word_count = len(text.split())

    # If we got reasonable text, use it
    if word_count > 50:
        return text

    # Fall back to Claude Vision with rendered page images
    pages_b64 = await loop.run_in_executor(None, _pdf_to_base64_images, file_path)
    if not pages_b64:
        return text  # Return whatever we had

    return await _claude_vision_extract(pages_b64)


def _pypdf_extract(file_path: str) -> str:
    """Extract text from PDF using pypdf."""
    try:
        import pypdf
        reader = pypdf.PdfReader(file_path)
        pages_text = []
        for page in reader.pages:
            pages_text.append(page.extract_text() or "")
        return "\n\n".join(pages_text)
    except Exception:
        return ""


def _pdf_to_base64_images(file_path: str) -> list[str]:
    """Render PDF pages to base64 PNG images using pymupdf."""
    try:
        import fitz  # pymupdf
        doc = fitz.open(file_path)
        pages_b64 = []
        for page_num in range(min(len(doc), 20)):
            page = doc[page_num]
            mat = fitz.Matrix(2, 2)  # 2x zoom for clarity
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            b64 = base64.b64encode(img_bytes).decode()
            pages_b64.append(b64)
        doc.close()
        return pages_b64
    except Exception:
        return []


async def _claude_vision_extract(pages_b64: list[str]) -> str:
    """Send page images to Claude Vision for text extraction."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    content = []
    for b64 in pages_b64[:10]:  # limit to 10 pages per call
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        })

    content.append({
        "type": "text",
        "text": (
            "Extract all text from these document pages. Include all mathematical "
            "expressions, equations, and formulas using plain text notation. "
            "If there is handwriting, transcribe it accurately. "
            "Preserve the document structure. "
            "Return only the extracted text, nothing else."
        ),
    })

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )
    return response.content[0].text


async def pdf_pages_to_base64(file_path: str) -> list[str]:
    """Public helper for homework checker — returns base64 PNG list."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _pdf_to_base64_images, file_path)
