import asyncio
import json
import random
import re
from typing import Optional, AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import QuizSession, QuizQuestion, LearningEvent
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
    language: str = "en",
    user_id: Optional[str] = None,
) -> QuizSession:
    # When no topic is given, randomly assign one course topic per question
    assigned_topics: list[str] | None = None
    if not topic:
        topics_result = await db.execute(
            select(LearningEvent.topic)
            .where(
                LearningEvent.course_id == course_id,
                LearningEvent.event_type == "document_topic",
                LearningEvent.topic.isnot(None),
            )
            .distinct()
        )
        available_topics = [row[0] for row in topics_result.all()]
        if available_topics:
            assigned_topics = [random.choice(available_topics) for _ in range(count)]

    # Build RAG context first (read-only DB access)
    if assigned_topics:
        query = ", ".join(dict.fromkeys(assigned_topics))  # unique topics, order-preserving
    elif topic:
        query = topic
    else:
        query = "general course content"

    context = await rag.retrieve_context(db, query, course_id, top_k=10)
    extra_system = (
        "Use ONLY the following course materials to generate questions. "
        "Do not use general knowledge not present in these materials.\n\n"
        f"{context}"
    ) if context else None

    difficulty_map = {"easy": "basic conceptual", "medium": "intermediate", "hard": "advanced and challenging"}
    difficulty_desc = difficulty_map.get(difficulty, "intermediate")
    if question_type == "multiple_choice":
        qtype_instruction = "Use only multiple_choice questions."
    elif question_type == "free_text":
        qtype_instruction = "Use only free_text questions."
    else:
        qtype_instruction = "Mix multiple choice and free text questions."
    if question_type != "multiple_choice":
        qtype_instruction += (
            " Free-text questions must each contain exactly one focused sub-question"
            " (no multi-part questions). Write concisely so the student can give a precise answer."
        )

    if assigned_topics:
        topic_assignments = "\n".join(f"{i+1}. {t}" for i, t in enumerate(assigned_topics))
        topic_instruction = (
            f"Generate exactly {count} {difficulty_desc} questions — "
            f"one question per topic in this exact list:\n{topic_assignments}\n"
        )
    elif topic:
        topic_instruction = f"Generate {count} {difficulty_desc} quiz questions on the topic: {topic}\n"
    else:
        topic_instruction = f"Generate {count} {difficulty_desc} quiz questions\n"

    prompt = (
        f"{topic_instruction}"
        f"for an electrical engineering student. {qtype_instruction}\n"
        "Return a JSON array. Each element must have exactly these fields:\n"
        "  question_text: string\n"
        "  question_type: \"multiple_choice\" or \"free_text\"\n"
        "  options: for multiple_choice, exactly 4 objects: "
        "[{\"label\": \"Full option text\", \"value\": \"A\"}, "
        "{\"label\": \"...\", \"value\": \"B\"}, "
        "{\"label\": \"...\", \"value\": \"C\"}, "
        "{\"label\": \"...\", \"value\": \"D\"}]; for free_text: null\n"
        "  IMPORTANT: in option labels use only inline math $...$ (never display math $$...$$)\n"
        "  correct_answer: for multiple_choice, the letter A/B/C/D; "
        "for free_text, a complete model answer (2-4 sentences) the student's response will be graded against\n"
        "  topic: 2-4 word topic label\n"
        "Output raw JSON array only, no markdown."
    )

    response = await claude.complete(
        db=db,
        messages=[{"role": "user", "content": prompt}],
        course_id=course_id,
        max_tokens=3000,
        extra_system=extra_system,
        language=language,
        model="claude-haiku-4-5-20251001",
    )

    questions_data = _parse_json_array(response)

    # Only write to DB after Claude responds successfully (avoids dirty state on cancellation)
    session = QuizSession(
        course_id=course_id,
        mode=mode,
        knowledge_mode=knowledge_mode,
        total_questions=count,
        topic=topic,
        difficulty=difficulty,
        user_id=user_id,
    )
    db.add(session)
    await db.flush()

    for item in questions_data:
        q = QuizQuestion(
            session_id=session.id,
            question_text=item.get("question_text", ""),
            question_type=item.get("question_type", "free_text"),
            options=_normalize_options(item.get("options")),
            correct_answer=item.get("correct_answer", ""),
            topic=item.get("topic"),
            points_possible=1.0,
        )
        db.add(q)

    await db.flush()
    return session


async def generate_single_question(
    db: AsyncSession,
    course_id: str,
    topic: str,
    difficulty: str,
    question_type: str,
    language: str = "en",
) -> dict:
    """Generate one replacement question on a given topic. Returns a normalized dict."""
    context = await rag.retrieve_context(db, topic, course_id, top_k=10)
    extra_system = (
        "Use ONLY the following course materials to generate questions. "
        "Do not use general knowledge not present in these materials.\n\n"
        f"{context}"
    ) if context else None

    difficulty_map = {"easy": "basic conceptual", "medium": "intermediate", "hard": "advanced and challenging"}
    difficulty_desc = difficulty_map.get(difficulty, "intermediate")

    if question_type == "multiple_choice":
        qtype_instruction = "Generate a multiple_choice question."
    else:
        qtype_instruction = (
            "Generate a free_text question. Write exactly one focused sub-question "
            "(no multi-part). Write concisely so the student can give a precise answer."
        )

    prompt = (
        f"Generate exactly 1 {difficulty_desc} quiz question on the topic: {topic}\n"
        f"for an electrical engineering student. {qtype_instruction}\n"
        "Return a JSON array with exactly 1 element having these fields:\n"
        "  question_text: string\n"
        "  question_type: \"multiple_choice\" or \"free_text\"\n"
        "  options: for multiple_choice, exactly 4 objects: "
        "[{\"label\": \"Full option text\", \"value\": \"A\"}, "
        "{\"label\": \"...\", \"value\": \"B\"}, "
        "{\"label\": \"...\", \"value\": \"C\"}, "
        "{\"label\": \"...\", \"value\": \"D\"}]; for free_text: null\n"
        "  IMPORTANT: in option labels use only inline math $...$ (never display math $$...$$)\n"
        "  correct_answer: for multiple_choice, the letter A/B/C/D; "
        "for free_text, a complete model answer (2-4 sentences)\n"
        "  topic: 2-4 word topic label\n"
        "Output raw JSON array only, no markdown."
    )

    response = await claude.complete(
        db=db,
        messages=[{"role": "user", "content": prompt}],
        course_id=course_id,
        max_tokens=1000,
        extra_system=extra_system,
        language=language,
        model="claude-haiku-4-5-20251001",
    )

    items = _parse_json_array(response)
    if not items:
        raise ValueError("No question generated")
    item = items[0]
    item["options"] = _normalize_options(item.get("options"))
    return item


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
                    model="claude-haiku-4-5-20251001",
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


async def _grade_one_ft(
    question_text: str, correct_answer: str, student_answer: str, system_prompt: str
) -> tuple[float, str]:
    """Grade one free-text answer via Claude. Pure Claude call — no DB access, parallelizable."""
    prompt = (
        f"Question: {question_text}\n"
        f"Correct answer: {correct_answer}\n"
        f"Student answer: {student_answer}\n\n"
        'Grade this answer 0-1 (0=wrong, 0.5=partial, 1=correct). '
        'Return JSON: {"score": <0|0.5|1>, "feedback": "<brief feedback>"}'
    )
    try:
        resp = await claude.complete_with_system(
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            model="claude-haiku-4-5-20251001",
        )
        data = _parse_json_obj(resp)
        return float(data.get("score", 0)), data.get("feedback", "")
    except Exception:
        return 0.0, ""


async def grade_quiz_stream_gen(
    questions: dict,      # {q_id: QuizQuestion} — student_answer already saved
    system_prompt: str,
) -> AsyncIterator[str]:
    """Async generator yielding SSE event strings for the grade-stream endpoint.
    Only updates in-memory objects — no DB access (avoids MissingGreenlet in StreamingResponse)."""
    mc_qs = [(qid, q) for qid, q in questions.items() if q.question_type == "multiple_choice"]
    ft_qs = [(qid, q) for qid, q in questions.items() if q.question_type != "multiple_choice"]

    # Grade MC questions instantly (no Claude needed)
    for qid, q in mc_qs:
        correct = (q.student_answer or "").strip().upper() == (q.correct_answer or "").strip().upper()
        q.points_earned = q.points_possible if correct else 0.0
        q.ai_feedback = "Correct!" if correct else f"Correct answer: {q.correct_answer}"
        yield f"data: {json.dumps({'type': 'graded', 'question_id': qid, 'points_earned': q.points_earned, 'points_possible': q.points_possible, 'ai_feedback': q.ai_feedback, 'correct_answer': q.correct_answer})}\n\n"

    # Signal free-text questions as "checking"
    for qid, _ in ft_qs:
        yield f"data: {json.dumps({'type': 'checking', 'question_id': qid})}\n\n"

    # Grade free-text in parallel, emit each result as it completes
    async def grade_and_tag(qid: str, q: QuizQuestion) -> tuple[str, float, str]:
        score, feedback = await _grade_one_ft(
            q.question_text, q.correct_answer or "", q.student_answer or "", system_prompt
        )
        return qid, score, feedback

    tasks = [asyncio.create_task(grade_and_tag(qid, q)) for qid, q in ft_qs]
    for coro in asyncio.as_completed(tasks):
        qid, score, feedback = await coro
        q = questions[qid]
        q.points_earned = score * q.points_possible
        q.ai_feedback = feedback
        yield f"data: {json.dumps({'type': 'graded', 'question_id': qid, 'points_earned': q.points_earned, 'points_possible': q.points_possible, 'ai_feedback': feedback, 'correct_answer': q.correct_answer})}\n\n"


def _normalize_options(options) -> list | None:
    """Ensure options are [{label, value}] format regardless of what Claude returned."""
    if not options:
        return None
    letters = ["A", "B", "C", "D"]
    result = []
    for i, opt in enumerate(options[:4]):
        if isinstance(opt, str):
            result.append({"label": opt, "value": letters[i]})
        elif isinstance(opt, dict):
            label = (opt.get("label") or opt.get("text") or opt.get("option")
                     or opt.get("content") or str(opt))
            value = opt.get("value") or letters[i]
            result.append({"label": label, "value": value})
    return result or None


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
