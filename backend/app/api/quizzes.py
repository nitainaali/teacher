from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

from app.core.database import get_db
from app.models.models import QuizSession, QuizQuestion
from app.schemas.schemas import (
    QuizGenerateRequest, QuizSessionOut, QuizSessionDetail,
    QuizQuestionOut, QuizSubmitRequest, QuizSessionUpdate,
)
from app.services.quiz_generator import generate_quiz, grade_quiz

router = APIRouter(prefix="/api/quizzes", tags=["quizzes"])


@router.post("/generate", response_model=QuizSessionOut, status_code=201)
async def create_quiz(data: QuizGenerateRequest, db: AsyncSession = Depends(get_db)):
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
):
    query = select(QuizSession).order_by(QuizSession.created_at.desc())
    if course_id:
        query = query.where(QuizSession.course_id == course_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{session_id}", response_model=QuizSessionDetail)
async def get_quiz(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(QuizSession).where(QuizSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Quiz session not found")

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
):
    result = await db.execute(select(QuizSession).where(QuizSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Quiz session not found")
    if data.topic is not None:
        session.topic = data.topic
    if data.difficulty is not None:
        session.difficulty = data.difficulty
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
async def delete_quiz(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(QuizSession).where(QuizSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Quiz session not found")
    await db.delete(session)
    await db.commit()


@router.post("/{session_id}/submit", response_model=QuizSessionDetail)
async def submit_quiz(
    session_id: str,
    data: QuizSubmitRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(QuizSession).where(QuizSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Quiz session not found")
    if session.completed_at:
        raise HTTPException(400, "Quiz already submitted")

    session = await grade_quiz(db, session, data.answers)
    await db.commit()
    await db.refresh(session)
    return await get_quiz(session_id, db)
