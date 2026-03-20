"""Add SRS session engine: StudySession, ReviewLog, extend Flashcard

Revision ID: m7b8c9d0e1f2
Revises: l6a7b8c9d0e1
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'm7b8c9d0e1f2'
down_revision = 'l6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Extend flashcards with SRS tracking fields ────────────────────────────
    op.add_column('flashcards', sa.Column('review_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('flashcards', sa.Column('lapse_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('flashcards', sa.Column('retrievability_estimate', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('flashcards', sa.Column('last_rating', sa.Integer(), nullable=True))
    op.add_column('flashcards', sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=True))

    # ── New study_sessions table ───────────────────────────────────────────────
    op.create_table(
        'study_sessions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('course_id', sa.String(), sa.ForeignKey('courses.id', ondelete='CASCADE'), nullable=False),
        sa.Column('deck_id', sa.String(), sa.ForeignKey('flashcard_decks.id', ondelete='SET NULL'), nullable=True),
        sa.Column('topic_filter', sa.Text(), nullable=True),
        sa.Column('mode', sa.String(20), nullable=False, server_default='HYBRID'),
        sa.Column('intent', sa.String(30), nullable=False, server_default='NORMAL_STUDY'),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('target_duration_minutes', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('cards_seen_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('new_cards_seen_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('review_cards_seen_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_cards_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_card_id', sa.String(), nullable=True),
        sa.Column('card_exposures', JSONB, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # ── New review_logs table ──────────────────────────────────────────────────
    op.create_table(
        'review_logs',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('session_id', sa.String(), sa.ForeignKey('study_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('card_id', sa.String(), sa.ForeignKey('flashcards.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.String(), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('previous_state', sa.String(20), nullable=True),
        sa.Column('new_state', sa.String(20), nullable=True),
        sa.Column('previous_stability', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('new_stability', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('previous_difficulty', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('new_difficulty', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('previous_due_date', sa.Date(), nullable=True),
        sa.Column('new_due_date', sa.Date(), nullable=True),
        sa.Column('elapsed_days', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('mode_used', sa.String(20), nullable=True),
    )
    op.create_index('ix_review_logs_card_id', 'review_logs', ['card_id'])
    op.create_index('ix_review_logs_session_id', 'review_logs', ['session_id'])


def downgrade() -> None:
    op.drop_index('ix_review_logs_session_id', 'review_logs')
    op.drop_index('ix_review_logs_card_id', 'review_logs')
    op.drop_table('review_logs')
    op.drop_table('study_sessions')

    op.drop_column('flashcards', 'first_seen_at')
    op.drop_column('flashcards', 'last_rating')
    op.drop_column('flashcards', 'retrievability_estimate')
    op.drop_column('flashcards', 'lapse_count')
    op.drop_column('flashcards', 'review_count')
