"""upload_source and quiz topic/difficulty

Revision ID: e7f2a3b4c5d6
Revises: d4f9a1b2c3e5
Create Date: 2026-03-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e7f2a3b4c5d6'
down_revision: Union[str, None] = 'd4f9a1b2c3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # documents: track where file was uploaded from (knowledge page vs exam analysis)
    op.add_column('documents', sa.Column(
        'upload_source', sa.String(20), nullable=False, server_default='knowledge'
    ))

    # quiz_sessions: store the topic filter and difficulty used when generating
    op.add_column('quiz_sessions', sa.Column('topic', sa.Text(), nullable=True))
    op.add_column('quiz_sessions', sa.Column('difficulty', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('documents', 'upload_source')
    op.drop_column('quiz_sessions', 'topic')
    op.drop_column('quiz_sessions', 'difficulty')
