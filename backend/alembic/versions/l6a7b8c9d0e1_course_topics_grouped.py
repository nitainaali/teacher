"""Add topics_grouped to courses for LLM-merged topic list

Revision ID: l6a7b8c9d0e1
Revises: k5f6a7b8c9d0
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'l6a7b8c9d0e1'
down_revision = 'k5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('courses', sa.Column('topics_grouped', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('courses', 'topics_grouped')
