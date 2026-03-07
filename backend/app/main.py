from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.api import courses, documents, homework, flashcards, quizzes, chat, profile, progress, exams, transcripts, schedule, learning

app = FastAPI(title="AI Tutor API", version="1.0.0")

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


@app.get("/health")
async def health():
    return {"status": "ok"}
