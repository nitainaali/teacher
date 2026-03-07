"""add_topic_summaries

Revision ID: c51868513c91
Revises: 0002
Create Date: 2026-03-07 17:07:05.827291

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c51868513c91'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'topic_summaries',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('course_id', sa.String(), nullable=False),
        sa.Column('topic', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('guidance', sa.Text(), nullable=True),
        sa.Column('language', sa.String(10), nullable=False, server_default='en'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('topic_summaries')
