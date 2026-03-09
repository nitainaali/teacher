"""Fix upload_source for existing exam documents

Revision ID: f1a2b3c4d5e6
Revises: e7f2a3b4c5d6
Create Date: 2026-03-09

Retroactively marks all documents with doc_type='exam' as upload_source='exam_upload'.
This prevents old exam files from appearing in the Knowledge page.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e7f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Retroactively fix all pre-existing exam documents:
    # they got upload_source='knowledge' by the server_default, but should be 'exam_upload'
    op.execute(
        "UPDATE documents SET upload_source = 'exam_upload' WHERE doc_type = 'exam'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE documents SET upload_source = 'knowledge' WHERE doc_type = 'exam'"
    )
