"""Add images_b64 column to chat_sessions for multi-turn image context

Revision ID: k5f6a7b8c9d0
Revises: j4e5f6a7b8c9
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'k5f6a7b8c9d0'
down_revision = 'j4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_sessions',
        sa.Column('images_b64', JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('chat_sessions', 'images_b64')
