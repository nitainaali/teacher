"""Multi-user schema: new tables + nullable user_id columns

Revision ID: o1_multi_user_schema
Revises: n8c9d0e1f2a3
Create Date: 2026-03-21

Step 1 of 3: Creates new tables and adds nullable user_id columns.
AFTER running this migration, run: python -m scripts.migrate_to_multi_user
THEN run: alembic upgrade o2_multi_user_constraints
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector

revision = 'o1_multi_user_schema'
down_revision = 'n8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('username', sa.Text(), nullable=False),
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
    )

    # 2. Create shared_courses table
    op.create_table(
        'shared_courses',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(20), nullable=True, server_default='#6b7280'),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    )

    # 3. Create shared_documents table
    op.create_table(
        'shared_documents',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('shared_course_id', sa.String(), nullable=False),
        sa.Column('uploaded_by', sa.String(), nullable=True),
        sa.Column('filename', sa.Text(), nullable=False),
        sa.Column('original_name', sa.Text(), nullable=False),
        sa.Column('doc_type', sa.String(50), nullable=False, server_default='lecture'),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('extracted_text', sa.Text(), nullable=True),
        sa.Column('processing_status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('content_hash', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('metadata', JSONB, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shared_course_id'], ['shared_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ondelete='SET NULL'),
    )

    # 4. Create shared_document_chunks table
    op.create_table(
        'shared_document_chunks',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('shared_document_id', sa.String(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(384), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shared_document_id'], ['shared_documents.id'], ondelete='CASCADE'),
    )

    # 5. Add nullable user_id to courses
    op.add_column('courses', sa.Column('user_id', sa.String(), nullable=True))
    op.add_column('courses', sa.Column('active_shared_course_ids', JSONB, nullable=True, server_default='[]'))

    # 6. Add nullable user_id to student_profile
    op.add_column('student_profile', sa.Column('user_id', sa.String(), nullable=True))

    # 7. Add nullable user_id to learning_events
    op.add_column('learning_events', sa.Column('user_id', sa.String(), nullable=True))

    # 8. Add nullable user_id to student_performance
    op.add_column('student_performance', sa.Column('user_id', sa.String(), nullable=True))

    # 9. Add nullable user_id to homework_submissions
    op.add_column('homework_submissions', sa.Column('user_id', sa.String(), nullable=True))

    # 10. Add nullable user_id to topic_summaries
    op.add_column('topic_summaries', sa.Column('user_id', sa.String(), nullable=True))

    # 11. Add nullable user_id to study_sessions
    op.add_column('study_sessions', sa.Column('user_id', sa.String(), nullable=True))

    # 12. Add nullable user_id to review_logs
    op.add_column('review_logs', sa.Column('user_id', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('review_logs', 'user_id')
    op.drop_column('study_sessions', 'user_id')
    op.drop_column('topic_summaries', 'user_id')
    op.drop_column('homework_submissions', 'user_id')
    op.drop_column('student_performance', 'user_id')
    op.drop_column('learning_events', 'user_id')
    op.drop_column('student_profile', 'user_id')
    op.drop_column('courses', 'active_shared_course_ids')
    op.drop_column('courses', 'user_id')
    op.drop_table('shared_document_chunks')
    op.drop_table('shared_documents')
    op.drop_table('shared_courses')
    op.drop_table('users')
