import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

from app.core.database import get_db, AsyncSessionLocal
from app.models.models import QuizSession, QuizQuestion, User, Course
from app.schemas.schemas import (
    QuizGenerateRequest, QuizSessionOut, QuizSessionDetail,
    QuizQuestionOut, QuizSubmitRequest, QuizSessionUpdate,
)
from app.services.quiz_generator import generate_quiz, grade_quiz, grade_quiz_stream_gen
from app.services import claude as claude_svc
from app.services import student_intelligence
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/quizzes", tags=["quizzes"])


async def _get_quiz_owned(session_id: str, user_id: str, db: AsyncSession) -> QuizSession:
    """Fetch a quiz session and verify it belongs to the current user. Raises 404 otherwise."""
    result = await db.execute(
        select(QuizSession)
        .join(Course, QuizSession.course_id == Course.id)
        .where(QuizSession.id == session_id, Course.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Quiz session not found")
    return session


async def _write_quiz_completion_events(
    db: AsyncSession,
    questions: dict,
    course_id: str,
    user_id: str = None,
) -> None:
    """Write quiz_complete learning events per topic after grading."""
    topic_data: dict[str, dict] = {}
    for q in questions.values():
        topic = q.topic or "כללי"
        if topic not in topic_data:
            topic_data[topic] = {"earned": 0.0, "possible": 0.0, "count": 0}
        topic_data[topic]["earned"] += q.points_earned or 0.0
        topic_data[topic]["possible"] += q.points_possible or 1.0
        topic_data[topic]["count"] += 1

    for topic, data in topic_data.items():
        score = data["earned"] / data["possible"] if data["possible"] > 0 else 0.0
        await student_intelligence.write_learning_event(
            db=db,
            event_type="quiz_complete",
            course_id=course_id,
            topic=topic,
            details={"score": round(score, 3), "questions_count": data["count"]},
            user_id=user_id,
        )


@router.post("/generate", response_model=QuizSessionOut, status_code=201)
async def create_quiz(
    data: QuizGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify course ownership
    course_check = await db.execute(
        select(Course).where(Course.id == data.course_id, Course.user_id == current_user.id)
    )
    if not course_check.scalar_one_or_none():
        raise HTTPException(404, "Course not found")

    try:
        session = await generate_quiz(
            db=db,
            course_id=data.course_id,
            topic=data.topic,
            count=data.count,
            knowledge_mode=data.knowledge_mode,
            mode=data.mode,
            difficulty=data.difficulty,
            question_type=data.question_type,
            language=data.language,
        )
        await db.commit()
        await db.refresh(session)
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@router.get("/", response_model=List[QuizSessionOut])
async def list_quizzes(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(QuizSession)
        .join(Course, QuizSession.course_id == Course.id)
        .where(Course.user_id == current_user.id)
        .order_by(QuizSession.created_at.desc())
    )
    if course_id:
        query = query.where(QuizSession.course_id == course_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{session_id}", response_model=QuizSessionDetail)
async def get_quiz(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_quiz_owned(session_id, current_user.id, db)

    q_result = await db.execute(
        select(QuizQuestion).where(QuizQuestion.session_id == session_id)
    )
    questions = q_result.scalars().all()

    # Hide correct answers for incomplete quizzes
    questions_out = []
    for q in questions:
        q_dict = QuizQuestionOut.model_validate(q).model_dump()
        if not session.completed_at:
            q_dict["correct_answer"] = None
        questions_out.append(q_dict)

    return {**QuizSessionOut.model_validate(session).model_dump(), "questions": questions_out}


@router.patch("/{session_id}", response_model=QuizSessionOut)
async def update_quiz_metadata(
    session_id: str,
    data: QuizSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_quiz_owned(session_id, current_user.id, db)
    if data.topic is not None:
        session.topic = data.topic
    if data.difficulty is not None:
        session.difficulty = data.difficulty
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
async def delete_quiz(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_quiz_owned(session_id, current_user.id, db)
    await db.delete(session)
    await db.commit()


@router.post("/{session_id}/submit", response_model=QuizSessionDetail)
async def submit_quiz(
    session_id: str,
    data: QuizSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_quiz_owned(session_id, current_user.id, db)
    if session.completed_at:
        raise HTTPException(400, "Quiz already submitted")

    session = await grade_quiz(db, session, data.answers)
    await db.commit()
    await db.refresh(session)
    return await get_quiz(session_id, db, current_user)


@router.post("/{session_id}/grade-stream")
async def grade_quiz_sse(
    session_id: str,
    data: QuizSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """SSE endpoint: streams per-question grading results as they complete."""
    session = await _get_quiz_owned(session_id, current_user.id, db)
    if session.completed_at:
        raise HTTPException(400, "Quiz already submitted")

    q_result = await db.execute(select(QuizQuestion).where(QuizQuestion.session_id == session_id))
    questions = {q.id: q for q in q_result.scalars().all()}

    # Save student answers upfront (data.answers is List[dict])
    answers_map = {a["question_id"]: a["answer"] for a in data.answers}
    for q in questions.values():
        q.student_answer = answers_map.get(q.id, "")
    await db.flush()

    # Build system prompt once (DB access before generator starts)
    system_prompt = await claude_svc.build_system_prompt(db, session.course_id, user_id=current_user.id)
    user_id = current_user.id

    async def generate():
        async for event in grade_quiz_stream_gen(db, questions, system_prompt):
            yield event
        # Save final score using a fresh session (avoids stale-state after multiple flushes)
        total = sum(q.points_possible for q in questions.values())
        earned = sum((q.points_earned or 0.0) for q in questions.values())
        final_score = (earned / total * 100) if total > 0 else 0
        async with AsyncSessionLocal() as save_db:
            result2 = await save_db.execute(select(QuizSession).where(QuizSession.id == session_id))
            s = result2.scalar_one_or_none()
            if s:
                s.score = final_score
                s.completed_at = datetime.now(timezone.utc)
                # Write per-topic quiz_complete events for diagnosis
                try:
                    await _write_quiz_completion_events(save_db, questions, session.course_id, user_id=user_id)
                except Exception:
                    pass
                await save_db.commit()
        yield f"data: {json.dumps({'type': 'complete', 'score': final_score})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
