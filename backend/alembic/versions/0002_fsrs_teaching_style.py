"""Add FSRS fields to flashcards and teaching_style to student_profile

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add FSRS fields to flashcards
    op.add_column('flashcards', sa.Column('stability', sa.Float(), nullable=True, server_default='0.0'))
    op.add_column('flashcards', sa.Column('difficulty_fsrs', sa.Float(), nullable=True, server_default='0.3'))
    op.add_column('flashcards', sa.Column('fsrs_state', sa.String(20), nullable=True, server_default='new'))

    # Add teaching style to student_profile
    op.add_column('student_profile', sa.Column('teaching_style', sa.String(20), nullable=True, server_default='balanced'))
    op.add_column('student_profile', sa.Column('style_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('flashcards', 'stability')
    op.drop_column('flashcards', 'difficulty_fsrs')
    op.drop_column('flashcards', 'fsrs_state')
    op.drop_column('student_profile', 'teaching_style')
    op.drop_column('student_profile', 'style_notes')
