"""frontend_ux_sprint

Revision ID: d4f9a1b2c3e5
Revises: c51868513c91
Create Date: 2026-03-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f9a1b2c3e5'
down_revision: Union[str, None] = 'c51868513c91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add sort_order to courses
    op.add_column('courses', sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))

    # 2. Add content_hash to documents
    op.add_column('documents', sa.Column('content_hash', sa.String(64), nullable=True))

    # 3. Create flashcard_decks table
    op.create_table(
        'flashcard_decks',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('course_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False, server_default=''),
        sa.Column('topic', sa.Text(), nullable=True),
        sa.Column('difficulty', sa.String(20), nullable=False, server_default='medium'),
        sa.Column('card_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # 4. Add deck_id to flashcards
    op.add_column('flashcards', sa.Column('deck_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_flashcards_deck_id',
        'flashcards', 'flashcard_decks',
        ['deck_id'], ['id'],
        ondelete='CASCADE',
    )

    # 5. Create homework_submissions table
    op.create_table(
        'homework_submissions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('course_id', sa.String(), nullable=True),
        sa.Column('user_description', sa.Text(), nullable=True),
        sa.Column('filenames', sa.JSON(), nullable=True),
        sa.Column('analysis_result', sa.Text(), nullable=False),
        sa.Column('score_text', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # 6. Create exam_analysis_records table
    op.create_table(
        'exam_analysis_records',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('course_id', sa.String(), nullable=True),
        sa.Column('reference_exam_name', sa.String(), nullable=True),
        sa.Column('student_exam_name', sa.String(), nullable=True),
        sa.Column('analysis_result', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('exam_analysis_records')
    op.drop_table('homework_submissions')
    op.drop_constraint('fk_flashcards_deck_id', 'flashcards', type_='foreignkey')
    op.drop_column('flashcards', 'deck_id')
    op.drop_table('flashcard_decks')
    op.drop_column('documents', 'content_hash')
    op.drop_column('courses', 'sort_order')
