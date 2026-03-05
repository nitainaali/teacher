from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.services.embeddings import embed_text
from typing import Optional


async def retrieve_context(
    db: AsyncSession,
    query: str,
    course_id: Optional[str] = None,
    top_k: int = 5,
) -> str:
    """
    Embed query, search pgvector for nearest chunks filtered by course_id.
    Returns formatted context string.
    """
    query_embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    if course_id:
        sql = text("""
            SELECT dc.content, dc.chunk_index, d.original_name
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            WHERE d.course_id = :course_id
            ORDER BY dc.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)
        rows = await db.execute(sql, {"course_id": course_id, "embedding": embedding_str, "top_k": top_k})
    else:
        sql = text("""
            SELECT dc.content, dc.chunk_index, d.original_name
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            ORDER BY dc.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)
        rows = await db.execute(sql, {"embedding": embedding_str, "top_k": top_k})

    chunks = rows.fetchall()
    if not chunks:
        return ""

    parts = []
    for row in chunks:
        parts.append(f"[Source: {row.original_name}]\n{row.content}")

    return "\n\n---\n\n".join(parts)
