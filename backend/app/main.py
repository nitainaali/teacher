from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from passlib.context import CryptContext
from sqlalchemy import update, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
from app.api import courses, documents, homework, flashcards, quizzes, chat, profile, progress, exams, transcripts, schedule, learning, diagnosis, unified, users, shared_knowledge


async def _reset_stuck_documents() -> None:
    """On startup, reset documents stuck in 'processing' to 'error'.
    These are documents whose background task was killed (e.g. container restart).
    The user can delete and re-upload them from the Knowledge page."""
    try:
        from app.models.models import Document
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                update(Document)
                .where(Document.processing_status == "processing")
                .values(
                    processing_status="error",
                    metadata_={"error": "Processing interrupted — please delete and re-upload"},
                )
            )
            stuck = result.rowcount
            if stuck:
                await db.commit()
                print(f"[startup] Reset {stuck} stuck document(s) from 'processing' → 'error'")
    except Exception as exc:
        print(f"[startup] Could not reset stuck documents: {exc}")


async def _recover_shared_documents() -> None:
    """On startup, fix shared documents whose background tasks were lost on container restart.
    - 'processing' → reset to 'error' (interrupted mid-run)
    - 'pending'    → requeue processing (background task was never started or was lost)
    """
    import asyncio
    try:
        from sqlalchemy import select
        from app.models.models import SharedDocument
        from app.api.shared_knowledge import _process_in_new_session

        async with AsyncSessionLocal() as db:
            # Reset interrupted ones
            stuck_result = await db.execute(
                update(SharedDocument)
                .where(SharedDocument.processing_status == "processing")
                .values(
                    processing_status="error",
                    metadata_={"error": "Processing interrupted — use retry button"},
                )
                .returning(SharedDocument.id)
            )
            stuck_ids = [r[0] for r in stuck_result.fetchall()]

            # Find pending ones to requeue
            pending_result = await db.execute(
                select(SharedDocument.id).where(SharedDocument.processing_status == "pending")
            )
            pending_ids = [r[0] for r in pending_result.fetchall()]

            if stuck_ids or pending_ids:
                await db.commit()

        if stuck_ids:
            print(f"[startup] Reset {len(stuck_ids)} stuck shared document(s) → 'error'")
        if pending_ids:
            print(f"[startup] Requeueing {len(pending_ids)} pending shared document(s)")
            for doc_id in pending_ids:
                asyncio.ensure_future(_process_in_new_session(doc_id))

    except Exception as exc:
        print(f"[startup] Could not recover shared documents: {exc}")


async def _seed_admin_password() -> None:
    """On startup, set the admin password if not already set.
    Uses the ADMIN_PASSWORD env var (default: '5499').
    Idempotent — only hashes and saves if password_hash is None."""
    try:
        from app.models.models import User
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.is_admin == True))
            admin = result.scalar_one_or_none()
            if admin and admin.password_hash is None:
                admin.password_hash = pwd_context.hash(settings.admin_password)
                await db.commit()
                print("[startup] Admin password seeded")
    except Exception as exc:
        print(f"[startup] Could not seed admin password: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _reset_stuck_documents()
    await _recover_shared_documents()
    await _seed_admin_password()
    yield


app = FastAPI(title="AI Tutor API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all handler — ensures a proper JSON response is always sent.
    Without this, unhandled exceptions can drop the TCP connection before
    a response is sent, causing axios to report 'Network Error'."""
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)[:300]},
    )


app.include_router(courses.router)
app.include_router(documents.router)
app.include_router(homework.router)
app.include_router(flashcards.router)
app.include_router(quizzes.router)
app.include_router(chat.router)
app.include_router(profile.router)
app.include_router(progress.router)
app.include_router(exams.router)
app.include_router(transcripts.router)
app.include_router(schedule.router)
app.include_router(learning.router)
app.include_router(diagnosis.router)
app.include_router(unified.router)
app.include_router(users.router)
app.include_router(shared_knowledge.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
