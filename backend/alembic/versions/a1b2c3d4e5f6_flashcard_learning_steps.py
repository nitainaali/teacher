"""Add learning_step and next_review_at to flashcards for sub-day intervals

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-13

Adds:
- learning_step (int, nullable): which learning step index (0=1min, 1=10min, null=graduated)
- next_review_at (datetime with timezone, nullable): full timestamp for sub-day due time
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('flashcards', sa.Column('learning_step', sa.Integer(), nullable=True))
    op.add_column('flashcards', sa.Column('next_review_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('flashcards', 'next_review_at')
    op.drop_column('flashcards', 'learning_step')
