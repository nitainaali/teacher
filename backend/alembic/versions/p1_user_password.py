"""Add password_hash column to users table

Revision ID: p1_user_password
Revises: o2_multi_user_constraints
Create Date: 2026-03-22

"""
from alembic import op
import sqlalchemy as sa

revision = "p1_user_password"
down_revision = "o2_multi_user_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_hash")
