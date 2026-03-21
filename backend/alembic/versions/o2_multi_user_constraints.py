"""Multi-user constraints: NOT NULL + FK + indexes

Revision ID: o2_multi_user_constraints
Revises: o1_multi_user_schema
Create Date: 2026-03-21

Step 3 of 3: Adds NOT NULL constraints, FK relationships, and indexes.
Run ONLY after the data migration script has populated all user_id columns.
"""
from alembic import op
import sqlalchemy as sa

revision = 'o2_multi_user_constraints'
down_revision = 'o1_multi_user_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # courses.user_id — NOT NULL + FK + index
    op.alter_column('courses', 'user_id', nullable=False)
    op.create_foreign_key('fk_courses_user_id', 'courses', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_courses_user_id', 'courses', ['user_id'])

    # student_profile.user_id — NOT NULL + unique + FK
    op.alter_column('student_profile', 'user_id', nullable=False)
    op.create_foreign_key('fk_student_profile_user_id', 'student_profile', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_unique_constraint('uq_student_profile_user_id', 'student_profile', ['user_id'])

    # learning_events.user_id — NOT NULL + FK + index
    op.alter_column('learning_events', 'user_id', nullable=False)
    op.create_foreign_key('fk_learning_events_user_id', 'learning_events', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_learning_events_user_id', 'learning_events', ['user_id'])

    # student_performance.user_id — NOT NULL + FK + index
    op.alter_column('student_performance', 'user_id', nullable=False)
    op.create_foreign_key('fk_student_performance_user_id', 'student_performance', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_student_performance_user_id', 'student_performance', ['user_id'])

    # homework_submissions.user_id — NOT NULL + FK + index
    op.alter_column('homework_submissions', 'user_id', nullable=False)
    op.create_foreign_key('fk_homework_submissions_user_id', 'homework_submissions', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_homework_submissions_user_id', 'homework_submissions', ['user_id'])

    # topic_summaries.user_id — NOT NULL + FK + index
    op.alter_column('topic_summaries', 'user_id', nullable=False)
    op.create_foreign_key('fk_topic_summaries_user_id', 'topic_summaries', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_topic_summaries_user_id', 'topic_summaries', ['user_id'])

    # study_sessions.user_id — NOT NULL + FK + index
    op.alter_column('study_sessions', 'user_id', nullable=False)
    op.create_foreign_key('fk_study_sessions_user_id', 'study_sessions', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_study_sessions_user_id', 'study_sessions', ['user_id'])

    # review_logs.user_id — NOT NULL + FK + index
    op.alter_column('review_logs', 'user_id', nullable=False)
    op.create_foreign_key('fk_review_logs_user_id', 'review_logs', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_review_logs_user_id', 'review_logs', ['user_id'])

    # Index on shared_document_chunks for fast RAG (IVFFlat for cosine similarity)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_shared_doc_chunks_embedding "
        "ON shared_document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_shared_doc_chunks_embedding")

    for table, col, fk_name, idx_name in [
        ('review_logs', 'user_id', 'fk_review_logs_user_id', 'ix_review_logs_user_id'),
        ('study_sessions', 'user_id', 'fk_study_sessions_user_id', 'ix_study_sessions_user_id'),
        ('topic_summaries', 'user_id', 'fk_topic_summaries_user_id', 'ix_topic_summaries_user_id'),
        ('homework_submissions', 'user_id', 'fk_homework_submissions_user_id', 'ix_homework_submissions_user_id'),
        ('student_performance', 'user_id', 'fk_student_performance_user_id', 'ix_student_performance_user_id'),
        ('learning_events', 'user_id', 'fk_learning_events_user_id', 'ix_learning_events_user_id'),
        ('courses', 'user_id', 'fk_courses_user_id', 'ix_courses_user_id'),
    ]:
        op.drop_index(idx_name, table_name=table)
        op.drop_constraint(fk_name, table, type_='foreignkey')
        op.alter_column(table, col, nullable=True)

    op.drop_constraint('uq_student_profile_user_id', 'student_profile', type_='unique')
    op.drop_constraint('fk_student_profile_user_id', 'student_profile', type_='foreignkey')
    op.alter_column('student_profile', 'user_id', nullable=True)
