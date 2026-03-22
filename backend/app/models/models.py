import uuid
from datetime import datetime, date
from typing import Optional
from sqlalchemy import (
    String, Text, Float, Integer, Boolean, DateTime, Date,
    ForeignKey, JSON, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector
from app.core.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    courses: Mapped[list["Course"]] = relationship("Course", back_populates="user", passive_deletes=True)
    profile: Mapped[Optional["StudentProfile"]] = relationship("StudentProfile", back_populates="user", uselist=False, passive_deletes=True)


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    topics_grouped: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    active_shared_course_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    user: Mapped[Optional["User"]] = relationship("User", back_populates="courses")

    documents: Mapped[list["Document"]] = relationship("Document", back_populates="course")
    flashcards: Mapped[list["Flashcard"]] = relationship("Flashcard", back_populates="course")
    flashcard_decks: Mapped[list["FlashcardDeck"]] = relationship("FlashcardDeck", back_populates="course")
    quiz_sessions: Mapped[list["QuizSession"]] = relationship("QuizSession", back_populates="course")
    study_sessions: Mapped[list["StudySession"]] = relationship("StudySession")
    exam_uploads: Mapped[list["ExamUpload"]] = relationship("ExamUpload", back_populates="course")
    learning_events: Mapped[list["LearningEvent"]] = relationship("LearningEvent", back_populates="course")
    chat_sessions: Mapped[list["ChatSession"]] = relationship("ChatSession", back_populates="course")
    homework_submissions: Mapped[list["HomeworkSubmission"]] = relationship("HomeworkSubmission", back_populates="course")
    exam_analysis_records: Mapped[list["ExamAnalysisRecord"]] = relationship("ExamAnalysisRecord", back_populates="course")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    original_name: Mapped[str] = mapped_column(Text, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(50), nullable=False)  # lecture|homework|exam|transcript|reference
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    processing_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|processing|done|error
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upload_source: Mapped[str] = mapped_column(String(20), default="knowledge")  # knowledge|exam_upload
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)

    course: Mapped["Course"] = relationship("Course", back_populates="documents")
    chunks: Mapped[list["DocumentChunk"]] = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")
    flashcards: Mapped[list["Flashcard"]] = relationship("Flashcard", back_populates="source_document")
    exam_uploads: Mapped[list["ExamUpload"]] = relationship("ExamUpload", back_populates="document")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")


class FlashcardDeck(Base):
    __tablename__ = "flashcard_decks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String, default="")
    topic: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")
    card_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship("Course", back_populates="flashcard_decks")
    cards: Mapped[list["Flashcard"]] = relationship("Flashcard", back_populates="deck", cascade="all, delete-orphan")


class Flashcard(Base):
    __tablename__ = "flashcards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    source_document_id: Mapped[str | None] = mapped_column(String, ForeignKey("documents.id", ondelete="SET NULL"))
    deck_id: Mapped[str | None] = mapped_column(String, ForeignKey("flashcard_decks.id", ondelete="CASCADE"), nullable=True)
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str | None] = mapped_column(Text)
    ease_factor: Mapped[float] = mapped_column(Float, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, default=1)
    repetitions: Mapped[int] = mapped_column(Integer, default=0)
    next_review_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # FSRS-4.5 fields (replaces SM-2 for scheduling)
    stability: Mapped[float] = mapped_column(Float, default=0.0)
    difficulty_fsrs: Mapped[float] = mapped_column(Float, default=0.3)
    fsrs_state: Mapped[str] = mapped_column(String(20), default="new")
    # Learning steps: sub-day intervals before graduating to long-term review
    learning_step: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    next_review_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # SRS session engine tracking fields
    review_count: Mapped[int] = mapped_column(Integer, default=0)         # total reviews completed
    lapse_count: Mapped[int] = mapped_column(Integer, default=0)           # times forgotten (Again on review/relearning)
    retrievability_estimate: Mapped[float] = mapped_column(Float, default=0.0)  # R at last review
    last_rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-4
    first_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship("Course", back_populates="flashcards")
    source_document: Mapped["Document | None"] = relationship("Document", back_populates="flashcards")
    deck: Mapped["FlashcardDeck | None"] = relationship("FlashcardDeck", back_populates="cards")
    review_logs: Mapped[list["ReviewLog"]] = relationship("ReviewLog", back_populates="card")


class StudySession(Base):
    """Tracks a single flashcard study session with mode and intent."""
    __tablename__ = "study_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    deck_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("flashcard_decks.id", ondelete="SET NULL"), nullable=True)
    topic_filter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Study mode: ANKI_LIKE | COVERAGE_FIRST | HYBRID
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="HYBRID")
    # Session intent preset: QUICK_REFRESH | NORMAL_STUDY | DEEP_MEMORIZATION
    intent: Mapped[str] = mapped_column(String(30), nullable=False, default="NORMAL_STUDY")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    target_duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    # Session stats
    cards_seen_count: Mapped[int] = mapped_column(Integer, default=0)
    new_cards_seen_count: Mapped[int] = mapped_column(Integer, default=0)
    review_cards_seen_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_cards_count: Mapped[int] = mapped_column(Integer, default=0)
    # Policy engine state
    last_card_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # for immediate-repeat penalty
    card_exposures: Mapped[dict] = mapped_column(JSONB, default=dict)  # {card_id: exposure_count}
    # Session type: normal | one_time_all | one_time_learning (dry-run modes)
    session_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default="normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship("Course")
    review_logs: Mapped[list["ReviewLog"]] = relationship("ReviewLog", back_populates="session")


class ReviewLog(Base):
    """Immutable log of every card review — used for analytics and future optimizer training."""
    __tablename__ = "review_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("study_sessions.id", ondelete="CASCADE"))
    card_id: Mapped[str] = mapped_column(String, ForeignKey("flashcards.id", ondelete="CASCADE"))
    course_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    rating: Mapped[int] = mapped_column(Integer, nullable=False)  # 1=Again, 2=Hard, 3=Good, 4=Easy
    previous_state: Mapped[Optional[str]] = mapped_column(String(20))
    new_state: Mapped[Optional[str]] = mapped_column(String(20))
    previous_stability: Mapped[float] = mapped_column(Float, default=0.0)
    new_stability: Mapped[float] = mapped_column(Float, default=0.0)
    previous_difficulty: Mapped[float] = mapped_column(Float, default=0.0)
    new_difficulty: Mapped[float] = mapped_column(Float, default=0.0)
    previous_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    new_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    elapsed_days: Mapped[float] = mapped_column(Float, default=0.0)
    mode_used: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    session: Mapped["StudySession"] = relationship("StudySession", back_populates="review_logs")
    card: Mapped["Flashcard"] = relationship("Flashcard", back_populates="review_logs")


class QuizSession(Base):
    __tablename__ = "quiz_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # practice|exam
    knowledge_mode: Mapped[str] = mapped_column(String(20), nullable=False)  # course_only|general
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[float | None] = mapped_column(Float)
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    topic: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[str | None] = mapped_column(String(20))

    course: Mapped["Course"] = relationship("Course", back_populates="quiz_sessions")
    questions: Mapped[list["QuizQuestion"]] = relationship("QuizQuestion", back_populates="session", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("quiz_sessions.id", ondelete="CASCADE"))
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(20), nullable=False)  # multiple_choice|free_text
    options: Mapped[list | None] = mapped_column(JSONB)
    correct_answer: Mapped[str] = mapped_column(Text, nullable=False)
    student_answer: Mapped[str | None] = mapped_column(Text)
    ai_feedback: Mapped[str | None] = mapped_column(Text)
    points_possible: Mapped[float] = mapped_column(Float, default=1.0)
    points_earned: Mapped[float | None] = mapped_column(Float)
    topic: Mapped[str | None] = mapped_column(Text)

    session: Mapped["QuizSession"] = relationship("QuizSession", back_populates="questions")


class StudentPerformance(Base):
    __tablename__ = "student_performance"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    course_id: Mapped[str | None] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    metric_type: Mapped[str] = mapped_column(String(50), nullable=False)  # quiz_score|flashcard_ease|homework_score
    value: Mapped[float] = mapped_column(Float, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExamUpload(Base):
    __tablename__ = "exam_uploads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id", ondelete="CASCADE"))
    exam_type: Mapped[str] = mapped_column(String(30), nullable=False)  # reference|student_submission
    reference_exam_id: Mapped[str | None] = mapped_column(String, ForeignKey("exam_uploads.id", ondelete="SET NULL"))
    analysis: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship("Course", back_populates="exam_uploads")
    document: Mapped["Document"] = relationship("Document", back_populates="exam_uploads")


class StudentProfile(Base):
    __tablename__ = "student_profile"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, unique=True)
    field_of_study: Mapped[str | None] = mapped_column(Text)
    institution: Mapped[str | None] = mapped_column(Text)
    year_of_study: Mapped[int | None] = mapped_column(Integer)
    preferences: Mapped[dict | None] = mapped_column(JSONB)
    teaching_style: Mapped[str] = mapped_column(String(20), default="balanced")  # direct|balanced|supportive
    style_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[Optional["User"]] = relationship("User", back_populates="profile")


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    course_id: Mapped[str | None] = mapped_column(String, ForeignKey("courses.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    topic: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course | None"] = relationship("Course", back_populates="learning_events")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str | None] = mapped_column(String, ForeignKey("courses.id", ondelete="SET NULL"))
    knowledge_mode: Mapped[str] = mapped_column(String(20), default="general")  # course_only|general
    source: Mapped[str] = mapped_column(String(50), default="chat")  # "chat" | "homework_chat"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    images_b64: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    course: Mapped["Course | None"] = relationship("Course", back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user|assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")


class TopicSummary(Base):
    __tablename__ = "topic_summaries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    guidance: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(10), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HomeworkSubmission(Base):
    __tablename__ = "homework_submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    course_id: Mapped[str | None] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    user_description: Mapped[str | None] = mapped_column(Text)
    filenames: Mapped[list | None] = mapped_column(JSONB)  # list of original filenames
    analysis_result: Mapped[str] = mapped_column(Text, nullable=False)
    score_text: Mapped[str | None] = mapped_column(String(50))
    chat_messages: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    images_b64: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # processed base64 images (capped at 3)
    chat_session_id: Mapped[str | None] = mapped_column(String, nullable=True)  # links to ChatSession for context continuity
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course | None"] = relationship("Course", back_populates="homework_submissions")


class ExamAnalysisRecord(Base):
    __tablename__ = "exam_analysis_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str | None] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    reference_exam_name: Mapped[str | None] = mapped_column(String)
    student_exam_name: Mapped[str | None] = mapped_column(String)
    analysis_result: Mapped[str] = mapped_column(Text, nullable=False)
    chat_session_id: Mapped[str | None] = mapped_column(String, nullable=True)  # links to ChatSession for follow-up chat
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course | None"] = relationship("Course", back_populates="exam_analysis_records")


# Phase 2 tables
class ExamDate(Base):
    __tablename__ = "exam_dates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    exam_name: Mapped[str] = mapped_column(Text, nullable=False)
    exam_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PlannedStudySession(Base):
    __tablename__ = "planned_study_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    course_id: Mapped[str] = mapped_column(String, ForeignKey("courses.id", ondelete="CASCADE"))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    planned_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_duration_minutes: Mapped[int | None] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ─── Shared Knowledge Library ───────────────────────────────────────────────

class SharedCourse(Base):
    """Admin-managed global knowledge collection (e.g. 'Signals 101')."""
    __tablename__ = "shared_courses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20), default="#6b7280")
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    documents: Mapped[list["SharedDocument"]] = relationship("SharedDocument", back_populates="shared_course", cascade="all, delete-orphan")


class SharedDocument(Base):
    """A document uploaded to the shared knowledge library."""
    __tablename__ = "shared_documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shared_course_id: Mapped[str] = mapped_column(String, ForeignKey("shared_courses.id", ondelete="CASCADE"))
    uploaded_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    original_name: Mapped[str] = mapped_column(Text, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(50), nullable=False, default="lecture")
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    processing_status: Mapped[str] = mapped_column(String(20), default="pending")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)

    shared_course: Mapped["SharedCourse"] = relationship("SharedCourse", back_populates="documents")
    chunks: Mapped[list["SharedDocumentChunk"]] = relationship("SharedDocumentChunk", back_populates="document", cascade="all, delete-orphan")


class SharedDocumentChunk(Base):
    """Embedding chunk for a shared document — used in RAG searches."""
    __tablename__ = "shared_document_chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shared_document_id: Mapped[str] = mapped_column(String, ForeignKey("shared_documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped["SharedDocument"] = relationship("SharedDocument", back_populates="chunks")
