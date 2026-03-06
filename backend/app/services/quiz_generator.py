import json
import re
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import QuizSession, QuizQuestion
from app.services import claude, rag


async def generate_quiz(
    db: AsyncSession,
    course_id: str,
    topic: Optional[str],
    count: int,
    knowledge_mode: str,
    mode: str,
    difficulty: str = "medium",
    question_type: str = "mixed",
) -> QuizSession:
    session = QuizSession(
        course_id=course_id,
        mode=mode,
        knowledge_mode=knowledge_mode,
        total_questions=count,
    )
    db.add(session)
    await db.flush()

    extra_system = None
    if knowledge_mode == "course_only":
        query = topic or "general course content"
        context = await rag.retrieve_context(db, query, course_id, top_k=5)
        if context:
            extra_system = f"Relevant course materials:\n\n{context}"

    topic_str = f" on the topic: {topic}" if topic else ""
    difficulty_map = {"easy": "basic conceptual", "medium": "intermediate", "hard": "advanced and challenging"}
    difficulty_desc = difficulty_map.get(difficulty, "intermediate")
    if question_type == "multiple_choice":
        qtype_instruction = "Use only multiple_choice questions."
    elif question_type == "free_text":
        qtype_instruction = "Use only free_text questions."
    else:
        qtype_instruction = "Mix multiple choice and free text questions."
    prompt = (
        f"Generate {count} {difficulty_desc} quiz questions{topic_str} for an electrical engineering student. "
        f"{qtype_instruction} "
        "Return a JSON array. Each object must have:\n"
        "- question_text: string\n"
        "- question_type: 'multiple_choice' or 'free_text'\n"
        "- options: array of {label, value} for MC, null for free_text\n"
        "- correct_answer: string\n"
        "- topic: 2-4 word topic label\n"
        "Raw JSON array only, no markdown."
    )

    response = await claude.complete(
        db=db,
        messages=[{"role": "user", "content": prompt}],
        course_id=course_id,
        max_tokens=3000,
        extra_system=extra_system,
    )

    questions_data = _parse_json_array(response)
    for item in questions_data:
        q = QuizQuestion(
            session_id=session.id,
            question_text=item.get("question_text", ""),
            question_type=item.get("question_type", "free_text"),
            options=item.get("options"),
            correct_answer=item.get("correct_answer", ""),
            topic=item.get("topic"),
            points_possible=1.0,
        )
        db.add(q)

    await db.flush()
    return session


async def grade_quiz(db: AsyncSession, session: QuizSession, answers: list[dict]) -> QuizSession:
    """Grade submitted answers. Free text graded by Claude."""
    from sqlalchemy import select
    result = await db.execute(
        select(QuizQuestion).where(QuizQuestion.session_id == session.id)
    )
    questions = {q.id: q for q in result.scalars().all()}

    total_points = 0.0
    earned_points = 0.0

    for answer in answers:
        q_id = answer.get("question_id")
        student_ans = answer.get("answer", "")
        q = questions.get(q_id)
        if not q:
            continue

        q.student_answer = student_ans
        total_points += q.points_possible

        if q.question_type == "multiple_choice":
            correct = student_ans.strip().lower() == q.correct_answer.strip().lower()
            q.points_earned = q.points_possible if correct else 0.0
            q.ai_feedback = "Correct!" if correct else f"Correct answer: {q.correct_answer}"
        else:
            # Grade free text with Claude
            grade_prompt = (
                f"Question: {q.question_text}\n"
                f"Correct answer: {q.correct_answer}\n"
                f"Student answer: {student_ans}\n\n"
                "Grade this answer 0-1 (0=wrong, 0.5=partial, 1=correct). "
                "Return JSON: {\"score\": <0|0.5|1>, \"feedback\": \"<brief feedback>\"}"
            )
            try:
                resp = await claude.complete(
                    db=db,
                    messages=[{"role": "user", "content": grade_prompt}],
                    max_tokens=200,
                )
                data = _parse_json_obj(resp)
                score = float(data.get("score", 0))
                q.points_earned = score * q.points_possible
                q.ai_feedback = data.get("feedback", "")
            except Exception:
                q.points_earned = 0.0

        earned_points += q.points_earned or 0.0

    from datetime import datetime, timezone
    session.completed_at = datetime.now(timezone.utc)
    session.score = (earned_points / total_points * 100) if total_points > 0 else 0
    await db.flush()
    return session


def _parse_json_array(text: str) -> list[dict]:
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return []


def _parse_json_obj(text: str) -> dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {}
