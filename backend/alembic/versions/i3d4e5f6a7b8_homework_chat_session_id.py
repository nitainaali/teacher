"""Add chat_session_id column to homework_submissions

Revision ID: i3d4e5f6a7b8
Revises: h2c3d4e5f6a7
Create Date: 2026-03-17

"""
from alembic import op
import sqlalchemy as sa

revision = 'i3d4e5f6a7b8'
down_revision = 'h2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'homework_submissions',
        sa.Column('chat_session_id', sa.String, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('homework_submissions', 'chat_session_id')
