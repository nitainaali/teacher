import base64
import re
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db, AsyncSessionLocal
from app.models.models import HomeworkSubmission
from app.schemas.schemas import HomeworkSubmissionOut
from app.services.homework_checker import check_homework_stream
from app.services.document_processor import pdf_pages_to_base64

router = APIRouter(prefix="/api/homework", tags=["homework"])


def _extract_score(text: str) -> Optional[str]:
    """Try to extract a score like '85/100' or '85%' from AI output."""
    match = re.search(r'\b(\d{1,3})\s*/\s*100\b|\b(\d{1,3})\s*%', text)
    if match:
        return match.group(0)
    return None


async def _save_submission(
    course_id: Optional[str],
    user_description: Optional[str],
    filenames: List[str],
    analysis_result: str,
):
    """Save homework submission in a new DB session (called after streaming)."""
    score_text = _extract_score(analysis_result)
    async with AsyncSessionLocal() as db:
        sub = HomeworkSubmission(
            course_id=course_id,
            user_description=user_description,
            filenames=filenames,
            analysis_result=analysis_result,
            score_text=score_text,
        )
        db.add(sub)
        await db.commit()


@router.post("/check")
async def check_homework(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    course_id: Optional[str] = Form(None),
    knowledge_mode: str = Form("general"),
    language: str = Form("en"),
    user_description: Optional[str] = Form(None),
    mode: str = Form("check"),
    revelation_level: int = Form(1),
    db: AsyncSession = Depends(get_db),
):
    images_b64: list[str] = []
    filenames: list[str] = []

    for file in files:
        content = await file.read()
        filename = file.filename or "upload"
        filenames.append(filename)

        if filename.lower().endswith(".pdf"):
            import tempfile, os
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                pages = await pdf_pages_to_base64(tmp_path)
                images_b64.extend(pages)
            finally:
                os.unlink(tmp_path)
        else:
            images_b64.append(base64.b64encode(content).decode())

    async def event_generator():
        collected: list[str] = []
        success = False
        try:
            async for token in check_homework_stream(images_b64, course_id, knowledge_mode, db, language=language, user_description=user_description, mode=mode, revelation_level=revelation_level):
                collected.append(token)
                yield f"data: {token.replace(chr(10), chr(92) + 'n')}\n\n"
            success = True
        except Exception as e:
            yield f"data: [ERROR:{str(e)[:200]}]\n\n"
        finally:
            yield "data: [DONE]\n\n"

        # Schedule save after stream is fully consumed (normal path only)
        if success:
            full_result = "".join(collected)
            if full_result.strip():
                background_tasks.add_task(
                    _save_submission, course_id, user_description, filenames, full_result
                )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/history", response_model=List[HomeworkSubmissionOut])
async def list_homework_history(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(HomeworkSubmission).order_by(HomeworkSubmission.created_at.desc())
    if course_id:
        query = query.where(HomeworkSubmission.course_id == course_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/history/{submission_id}", response_model=HomeworkSubmissionOut)
async def get_homework_submission(submission_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HomeworkSubmission).where(HomeworkSubmission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Submission not found")
    return sub


@router.patch("/history/{submission_id}", response_model=HomeworkSubmissionOut)
async def update_homework_submission(
    submission_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(HomeworkSubmission).where(HomeworkSubmission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Submission not found")
    if "chat_messages" in body:
        sub.chat_messages = body["chat_messages"]
    await db.commit()
    await db.refresh(sub)
    return sub


@router.delete("/history/{submission_id}", status_code=204)
async def delete_homework_submission(submission_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HomeworkSubmission).where(HomeworkSubmission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Submission not found")
    await db.delete(sub)
    await db.commit()
