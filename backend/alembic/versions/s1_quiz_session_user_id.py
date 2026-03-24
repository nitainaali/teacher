"""add user_id to quiz_sessions

Revision ID: s1_quiz_session_user_id
Revises: r1_document_chunks_ivfflat_index
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = "s1_quiz_session_user_id"
down_revision = "r1_document_chunks_ivfflat_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quiz_sessions",
        sa.Column("user_id", sa.String(), nullable=True),
    )
    op.create_foreign_key(
        "fk_quiz_sessions_user_id",
        "quiz_sessions", "users",
        ["user_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_quiz_sessions_user_id", "quiz_sessions", type_="foreignkey")
    op.drop_column("quiz_sessions", "user_id")
