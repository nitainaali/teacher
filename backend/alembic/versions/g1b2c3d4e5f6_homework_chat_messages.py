"""Add chat_messages column to homework_submissions

Revision ID: g1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'g1b2c3d4e5f6'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'homework_submissions',
        sa.Column('chat_messages', JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('homework_submissions', 'chat_messages')
