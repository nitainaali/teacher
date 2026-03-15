"""homework_chat_messages

Revision ID: a1b2c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-03-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1b2c4d5e6f7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'homework_submissions',
        sa.Column('chat_messages', postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column('homework_submissions', 'chat_messages')
