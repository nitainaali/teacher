"""Add chat_session_id to exam_analysis_records

Revision ID: j4e5f6a7b8c9
Revises: i3d4e5f6a7b8
Create Date: 2026-03-18


"""
from alembic import op
import sqlalchemy as sa

revision = 'j4e5f6a7b8c9'
down_revision = 'i3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'exam_analysis_records',
        sa.Column('chat_session_id', sa.String, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('exam_analysis_records', 'chat_session_id')
