"""Add IVFFlat index on document_chunks.embedding for faster RAG search

Revision ID: r1_document_chunks_ivfflat_index
Revises: q1_chat_session_user_id
Create Date: 2026-03-22

"""
from alembic import op

revision = "r1_document_chunks_ivfflat_index"
down_revision = "q1_chat_session_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_ivfflat "
        "ON document_chunks USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_ivfflat;")
