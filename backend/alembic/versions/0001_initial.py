"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-05

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "courses",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("color", sa.String(20)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "documents",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("original_name", sa.Text, nullable=False),
        sa.Column("doc_type", sa.String(50), nullable=False),
        sa.Column("file_path", sa.Text, nullable=False),
        sa.Column("extracted_text", sa.Text),
        sa.Column("processing_status", sa.String(20), server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("metadata", JSONB),
    )

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("document_id", sa.String, sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", sa.Text),  # Will be overridden by vector type below
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Use raw SQL to set proper vector type
    op.execute("ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)")

    op.create_table(
        "flashcards",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_document_id", sa.String, sa.ForeignKey("documents.id", ondelete="SET NULL")),
        sa.Column("front", sa.Text, nullable=False),
        sa.Column("back", sa.Text, nullable=False),
        sa.Column("topic", sa.Text),
        sa.Column("ease_factor", sa.Float, server_default="2.5"),
        sa.Column("interval_days", sa.Integer, server_default="1"),
        sa.Column("repetitions", sa.Integer, server_default="0"),
        sa.Column("next_review_date", sa.Date, server_default=sa.func.current_date()),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "quiz_sessions",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("knowledge_mode", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("score", sa.Float),
        sa.Column("total_questions", sa.Integer, server_default="0"),
    )

    op.create_table(
        "quiz_questions",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("session_id", sa.String, sa.ForeignKey("quiz_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("question_type", sa.String(20), nullable=False),
        sa.Column("options", JSONB),
        sa.Column("correct_answer", sa.Text, nullable=False),
        sa.Column("student_answer", sa.Text),
        sa.Column("ai_feedback", sa.Text),
        sa.Column("points_possible", sa.Float, server_default="1.0"),
        sa.Column("points_earned", sa.Float),
        sa.Column("topic", sa.Text),
    )

    op.create_table(
        "student_performance",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE")),
        sa.Column("topic", sa.Text, nullable=False),
        sa.Column("metric_type", sa.String(50), nullable=False),
        sa.Column("value", sa.Float, nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "exam_uploads",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.String, sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exam_type", sa.String(30), nullable=False),
        sa.Column("reference_exam_id", sa.String, sa.ForeignKey("exam_uploads.id", ondelete="SET NULL")),
        sa.Column("analysis", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "student_profile",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("field_of_study", sa.Text),
        sa.Column("institution", sa.Text),
        sa.Column("year_of_study", sa.Integer),
        sa.Column("preferences", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "learning_events",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="SET NULL")),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("topic", sa.Text),
        sa.Column("details", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="SET NULL")),
        sa.Column("knowledge_mode", sa.String(20), server_default="general"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("session_id", sa.String, sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Phase 2 tables
    op.create_table(
        "exam_dates",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exam_name", sa.Text, nullable=False),
        sa.Column("exam_date", sa.Date, nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "planned_study_sessions",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("course_id", sa.String, sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("planned_duration_minutes", sa.Integer, nullable=False),
        sa.Column("actual_duration_minutes", sa.Integer),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("planned_study_sessions")
    op.drop_table("exam_dates")
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    op.drop_table("learning_events")
    op.drop_table("student_profile")
    op.drop_table("exam_uploads")
    op.drop_table("student_performance")
    op.drop_table("quiz_questions")
    op.drop_table("quiz_sessions")
    op.drop_table("flashcards")
    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("courses")
