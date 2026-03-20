"""Add session_type to study_sessions

Revision ID: n8c9d0e1f2a3
Revises: m7b8c9d0e1f2
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa

revision = 'n8c9d0e1f2a3'
down_revision = 'm7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'study_sessions',
        sa.Column('session_type', sa.String(30), nullable=False, server_default='normal'),
    )


def downgrade() -> None:
    op.drop_column('study_sessions', 'session_type')
