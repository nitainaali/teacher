from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import ChatSession, ChatMessage, HomeworkSubmission, ExamAnalysisRecord
from app.schemas.schemas import UnifiedHistoryItem

router = APIRouter(prefix="/api/unified", tags=["unified"])


@router.get("/history", response_model=List[UnifiedHistoryItem])
async def get_unified_history(
    course_id: Optional[str] = None,
    type: Optional[str] = Query(None),  # all | general | homework | exam
    db: AsyncSession = Depends(get_db),
):
    """Return merged history from chat sessions, homework submissions, and exam analyses."""
    items: List[UnifiedHistoryItem] = []
    type_filter = type or "all"

    # ── General chat sessions ─────────────────────────────────────────────────
    if type_filter in ("all", "general"):
        query = (
            select(ChatSession)
            .where(ChatSession.source.notin_(["homework_chat", "exam_chat"]))
            .order_by(ChatSession.created_at.desc())
        )
        if course_id:
            query = query.where(ChatSession.course_id == course_id)
        sessions = (await db.execute(query)).scalars().all()

        for session in sessions:
            # Get first user message for title
            msg_result = await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id, ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.asc())
                .limit(1)
            )
            first_msg = msg_result.scalar_one_or_none()
            title = (first_msg.content[:80] if first_msg else "...").replace("\n", " ")
            items.append(UnifiedHistoryItem(
                id=session.id,
                type="general",
                title=title,
                created_at=session.created_at,
                metadata_={"knowledge_mode": session.knowledge_mode},
            ))

    # ── Homework submissions ──────────────────────────────────────────────────
    if type_filter in ("all", "homework"):
        query = select(HomeworkSubmission).order_by(HomeworkSubmission.created_at.desc())
        if course_id:
            query = query.where(HomeworkSubmission.course_id == course_id)
        submissions = (await db.execute(query)).scalars().all()

        for sub in submissions:
            filenames = sub.filenames or []
            title = filenames[0] if filenames else (sub.user_description or "...")
            chat_count = len(sub.chat_messages) if sub.chat_messages else 0
            items.append(UnifiedHistoryItem(
                id=sub.id,
                type="homework",
                title=title,
                created_at=sub.created_at,
                metadata_={
                    "score_text": sub.score_text,
                    "chat_round_count": chat_count,
                },
            ))

    # ── Exam analysis records ─────────────────────────────────────────────────
    if type_filter in ("all", "exam"):
        query = select(ExamAnalysisRecord).order_by(ExamAnalysisRecord.created_at.desc())
        if course_id:
            query = query.where(ExamAnalysisRecord.course_id == course_id)
        records = (await db.execute(query)).scalars().all()

        for record in records:
            title = record.student_exam_name or record.reference_exam_name or "..."
            items.append(UnifiedHistoryItem(
                id=record.id,
                type="exam",
                title=title,
                created_at=record.created_at,
                metadata_={
                    "reference_exam_name": record.reference_exam_name,
                },
            ))

    # Sort all items by created_at descending
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items
