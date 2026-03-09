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
        word_count = len(extracted_text.split())
        has_hebrew = any('\u05d0' <= c <= '\u05ea' for c in extracted_text)
        scan_quality = "good" if has_hebrew else ("partial" if word_count > 30 else "poor")
        doc.metadata_ = {"word_count": word_count, "scan_quality": scan_quality}

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

        # Extract topics — exam docs log to exam_topic (for recommendations),
        # all other docs log to document_topic (shown in Topic Summary left panel)
        if doc.doc_type == "exam":
            await _extract_exam_topics(db, doc)
        else:
            await _extract_document_topics(db, doc)

    except Exception as e:
        doc.processing_status = "error"
        doc.metadata_ = {"error": str(e)}
        await db.commit()


async def _extract_exam_topics(db: AsyncSession, doc: Document) -> None:
    """Extract key topics from an exam document and log as learning events."""
    if not doc.extracted_text:
        return
    from app.services import student_intelligence
    import json, re as _re
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        prompt = (
            "List the main engineering/math topics that are TESTED in this exam. "
            "Return a JSON array of strings in Hebrew (עברית), each 2-5 words. "
            "Examples: 'חוק קירכהוף מתח', 'טרנספורמט פורייה', 'גבול פונקציה'. "
            "Raw JSON array only, no markdown.\n\n"
            f"Exam content:\n{doc.extracted_text[:3000]}"
        )
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        match = _re.search(r'\[.*\]', text, _re.DOTALL)
        if match:
            topics = json.loads(match.group())
            for topic in topics:
                if isinstance(topic, str) and topic.strip():
                    await student_intelligence.write_learning_event(
                        db=db,
                        event_type="exam_topic",
                        course_id=doc.course_id,
                        topic=topic.strip(),
                        details={"document_id": doc.id, "document_name": doc.original_name},
                    )
            await db.commit()
    except Exception:
        pass


async def _extract_document_topics(db: AsyncSession, doc: Document) -> None:
    """Extract key topics from a lecture/summary/transcript document and log as learning events.

    Uses event_type='document_topic' so topics appear in the Topic Summary left panel
    immediately after upload — without requiring the student to interact with the content first.
    """
    if not doc.extracted_text:
        return
    from app.services import student_intelligence
    import json, re as _re
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        prompt = (
            "List the main engineering/math topics COVERED in this document. "
            "Return a JSON array of strings in Hebrew (עברית), each 2-5 words. "
            "Examples: 'טרנספורמט פורייה', 'יציבות מגבר op-amp', 'הגדרת גבול'. "
            "Include 5-8 specific topics. Raw JSON array only, no markdown.\n\n"
            f"Document content:\n{doc.extracted_text[:3000]}"
        )
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        match = _re.search(r'\[.*\]', text, _re.DOTALL)
        if match:
            topics = json.loads(match.group())
            for topic in topics:
                if isinstance(topic, str) and topic.strip():
                    await student_intelligence.write_learning_event(
                        db=db,
                        event_type="document_topic",
                        course_id=doc.course_id,
                        topic=topic.strip(),
                        details={"document_id": doc.id, "document_name": doc.original_name},
                    )
            await db.commit()
    except Exception:
        pass


def _text_looks_valid(text: str) -> bool:
    """Check whether pypdf-extracted text is actually readable Hebrew content.

    Hebrew PDFs that are scanned / use embedded font tricks often yield > 50 words of
    garbled Latin-like characters (e.g. "Ino4: +% - IN art-") with zero Hebrew letters.
    We only trust pypdf output when it contains at least one actual Hebrew character
    (Unicode range U+05D0-U+05EA).  Any text without Hebrew is treated as corrupted
    and the caller falls back to Claude Vision — which handles both Hebrew handwriting
    and English-only PDFs correctly.
    """
    if not text:
        return False
    return any('\u05d0' <= c <= '\u05ea' for c in text)


async def _extract_text(file_path: str) -> str:
    """
    Try pypdf text extraction first. If text is sparse (scanned/handwritten),
    or if the extracted text lacks Hebrew characters (garbled RTL encoding),
    fall back to Claude Vision via pymupdf-rendered page images.
    """
    loop = asyncio.get_event_loop()

    # Attempt text extraction via pypdf
    text = await loop.run_in_executor(None, _pypdf_extract, file_path)
    word_count = len(text.split())

    # Accept only if we have enough words AND the text looks like real content.
    # Hebrew PDFs with embedded-font issues yield > 50 "words" of garbage —
    # they have no Hebrew characters and fail the heuristic → fall back to Vision.
    if word_count > 50 and _text_looks_valid(text):
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
