import base64
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.homework_checker import check_homework_stream
from app.services.document_processor import pdf_pages_to_base64

router = APIRouter(prefix="/api/homework", tags=["homework"])


@router.post("/check")
async def check_homework(
    file: UploadFile = File(...),
    course_id: Optional[str] = Form(None),
    knowledge_mode: str = Form("general"),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    filename = file.filename or "upload"

    if filename.lower().endswith(".pdf"):
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            images_b64 = await pdf_pages_to_base64(tmp_path)
        finally:
            os.unlink(tmp_path)
    else:
        # Treat as image
        images_b64 = [base64.b64encode(content).decode()]

    async def event_generator():
        async for token in check_homework_stream(images_b64, course_id, knowledge_mode, db):
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
