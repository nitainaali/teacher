"""Add user_id to chat_sessions

Revision ID: q1_chat_session_user_id
Revises: p1_user_password
Create Date: 2026-03-22

"""
from alembic import op
import sqlalchemy as sa

revision = "q1_chat_session_user_id"
down_revision = "p1_user_password"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_sessions",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_column("chat_sessions", "user_id")
