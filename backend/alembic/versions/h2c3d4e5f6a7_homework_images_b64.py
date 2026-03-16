"""Add images_b64 column to homework_submissions

Revision ID: h2c3d4e5f6a7
Revises: b1c2d3e4f5a6
Create Date: 2026-03-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'h2c3d4e5f6a7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'homework_submissions',
        sa.Column('images_b64', JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('homework_submissions', 'images_b64')
