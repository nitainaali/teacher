import json
import re
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import Document, Flashcard
from app.services import claude


DIFFICULTY_INSTRUCTIONS = {
    "easy": (
        "Make the cards straightforward and accessible. Focus on basic definitions, "
        "key terms, and simple recall. Avoid complex multi-step reasoning. "
        "The student should be able to answer with basic knowledge."
    ),
    "medium": (
        "Mix difficulty levels. Include some straightforward recall questions "
        "and some that require deeper understanding or application."
    ),
    "hard": (
        "Generate hard flashcards with no hints whatsoever. "
        "The answer must match the source material exactly — verbatim definitions, exact formulas, "
        "precise phrasing. Questions should be direct and unambiguous, requiring the student to recall "
        "the exact wording from the material. No scaffolding, no partial clues."
    ),
}

TYPE_INSTRUCTIONS = {
    "comprehension": (
        "Focus on conceptual understanding — ask 'why' and 'how' questions that require "
        "deep understanding, not mere recall. Questions should probe the student's grasp "
        "of mechanisms, causes, and relationships."
    ),
    "memorization": (
        "Focus on factual recall — definitions, formulas, key terms, specific values, units, "
        "and important constants. Front should be the term/concept, back should be the definition or formula."
    ),
    "tricks": (
        "Focus on mnemonics and memory tricks — useful shortcuts, patterns, analogies, or "
        "tricks to remember difficult concepts. "
        "Front: 'What is a useful trick to remember [concept]?' "
        "Back: the mnemonic, shortcut, or analogy."
    ),
    "confusion": (
        "Create true/false challenge cards that TEST understanding by potentially confusing the student. "
        "Present a statement about a concept — some statements should be CORRECT and some should have "
        "subtle errors (wrong sign, wrong formula component, incorrect relationship). "
        "Front: a statement (sometimes correct, sometimes subtly wrong). "
        "Back: 'TRUE — [explanation]' or 'FALSE — [what's wrong and why]'. "
        "Make the wrong statements plausible but clearly incorrect on careful analysis."
    ),
    "mixed": (
        "Create a balanced mix of all card types: conceptual understanding (comprehension), "
        "factual recall (memorization), memory tricks (tricks), and true/false challenges (confusion). "
        "Distribute roughly equally across these four types."
    ),
}


def build_flashcard_prompt(
    doc_text: str,
    count: int,
    card_type: str = "mixed",
    difficulty: str = "medium",
    topic: Optional[str] = None,
    guidance: Optional[str] = None,
) -> str:
    """Build the flashcard generation prompt. Pure function — no DB access."""
    type_desc = TYPE_INSTRUCTIONS.get(card_type, TYPE_INSTRUCTIONS["mixed"])
    difficulty_desc = DIFFICULTY_INSTRUCTIONS.get(difficulty, DIFFICULTY_INSTRUCTIONS["medium"])
    topic_filter = f" Focus specifically on the topic: '{topic}'." if topic else ""
    guidance_str = f" Additional instruction: {guidance}." if guidance else ""
    return (
        f"Generate exactly {count} flashcards from the following study material.\n"
        f"Card type: {type_desc}\n"
        f"Difficulty: {difficulty_desc}{topic_filter}{guidance_str}\n\n"
        "Return a JSON array. Each object must have:\n"
        '- "front": the question, statement, or prompt (may include LaTeX: $...$ inline, $$...$$ display)\n'
        '- "back": the answer, explanation, or verdict (may include LaTeX)\n'
        '- "topic": 2-4 word topic label\n'
        '- "card_type": one of comprehension/memorization/tricks/confusion\n'
        "IMPORTANT: Output ONLY the raw JSON array. Start your response with [ and end with ]. No preamble, no explanation, no markdown code fences.\n\n"
        f"Study material:\n{doc_text[:5000]}"
    )


async def generate_flashcards(
    db: AsyncSession,
    document_id: str,
    course_id: str,
    count: int = 20,
    card_type: str = "mixed",
    topic: Optional[str] = None,
    guidance: Optional[str] = None,
    language: str = "en",
    difficulty: str = "medium",
    deck_id: Optional[str] = None,
) -> list[Flashcard]:
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise ValueError(f"Document {document_id} not found")
    if not doc.extracted_text:
        raise ValueError(f"Document '{doc.original_name}' has no extracted text yet. Make sure the document finished processing.")

    prompt = build_flashcard_prompt(doc.extracted_text, count, card_type, difficulty, topic, guidance)
    max_tokens = max(count * 220, 800)

    response = await claude.complete(
        db=db,
        messages=[{"role": "user", "content": prompt}],
        course_id=course_id,
        max_tokens=max_tokens,
        language=language,
    )

    cards_data = _parse_json_array(response)
    flashcards = []
    for item in cards_data:
        front = item.get("front", "").strip()
        back = item.get("back", "").strip()
        if not front or not back:
            continue
        card = Flashcard(
            course_id=course_id,
            source_document_id=document_id,
            deck_id=deck_id,
            front=front,
            back=back,
            topic=item.get("topic"),
        )
        db.add(card)
        flashcards.append(card)

    await db.flush()
    return flashcards


def _parse_json_array(text: str) -> list[dict]:
    # Strip markdown code fences if present
    cleaned = re.sub(r'^```(?:json)?\s*', '', text.strip())
    cleaned = re.sub(r'\s*```\s*$', '', cleaned.strip())
    match = re.search(r'\[.*\]', cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception as e:
            raise ValueError(f"Claude returned malformed JSON: {e}\nResponse: {text[:300]}")
    raise ValueError(f"Claude response did not contain a JSON array. Response: {text[:300]}")
