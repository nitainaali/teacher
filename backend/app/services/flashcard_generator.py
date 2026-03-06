import json
import re
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import Document, Flashcard
from app.services import claude


async def generate_flashcards(
    db: AsyncSession,
    document_id: str,
    course_id: str,
    count: int = 10,
    card_type: str = "mixed",
) -> list[Flashcard]:
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc or not doc.extracted_text:
        return []

    type_instructions = {
        "comprehension": "Focus on conceptual understanding questions — ask 'why' and 'how' to test deep understanding.",
        "memorization": "Focus on factual recall — definitions, formulas, key terms, and specific values.",
        "application": "Focus on problem-solving and application — ask the student to apply concepts to situations.",
        "mixed": "Mix comprehension, memorization, and application questions evenly.",
    }
    type_desc = type_instructions.get(card_type, type_instructions["mixed"])

    prompt = (
        f"Generate {count} flashcards from the following study material. {type_desc} "
        "Return a JSON array with objects having 'front' (question/concept), 'back' (answer/explanation), "
        "and 'topic' (2-4 word topic label) fields. Raw JSON only, no markdown.\n\n"
        f"Material:\n{doc.extracted_text[:4000]}"
    )

    response = await claude.complete(
        db=db,
        messages=[{"role": "user", "content": prompt}],
        course_id=course_id,
        max_tokens=2048,
    )

    cards_data = _parse_json_array(response)
    flashcards = []
    for item in cards_data:
        card = Flashcard(
            course_id=course_id,
            source_document_id=document_id,
            front=item.get("front", ""),
            back=item.get("back", ""),
            topic=item.get("topic"),
        )
        db.add(card)
        flashcards.append(card)

    await db.flush()
    return flashcards


def _parse_json_array(text: str) -> list[dict]:
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return []
