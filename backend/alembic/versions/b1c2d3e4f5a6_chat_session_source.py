"""Add source column to chat_sessions

Revision ID: b1c2d3e4f5a6
Revises: a1b2c4d5e6f7
Create Date: 2026-03-15 13:00:00.000000

Adds:
- source (str, default='chat'): distinguishes 'chat' sessions from 'homework_chat' sessions
  so that homework follow-up chats are hidden from the "Ask a Question" history sidebar.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a1b2c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'chat_sessions',
        sa.Column('source', sa.String(50), nullable=False, server_default='chat'),
    )


def downgrade() -> None:
    op.drop_column('chat_sessions', 'source')
