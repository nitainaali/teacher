from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.services.embeddings import embed_text
from typing import Optional


async def retrieve_context(
    db: AsyncSession,
    query: str,
    course_id: Optional[str] = None,
    top_k: int = 5,
    upload_source: Optional[str] = None,
) -> str:
    """
    Embed query, search pgvector for nearest chunks filtered by course_id.
    Optionally restrict to a specific upload_source (e.g. 'knowledge' to exclude
    exam documents from topic-summary RAG lookups).
    Returns formatted context string.
    """
    query_embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # Build WHERE clause dynamically
    where_parts = []
    params: dict = {"embedding": embedding_str, "top_k": top_k}
    if course_id:
        where_parts.append("d.course_id = :course_id")
        params["course_id"] = course_id
    if upload_source:
        where_parts.append("d.upload_source = :upload_source")
        params["upload_source"] = upload_source

    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = text(f"""
        SELECT dc.content, dc.chunk_index, d.original_name
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        {where_clause}
        ORDER BY dc.embedding <=> CAST(:embedding AS vector)
        LIMIT :top_k
    """)
    rows = await db.execute(sql, params)

    chunks = rows.fetchall()
    if not chunks:
        return ""

    parts = []
    for row in chunks:
        parts.append(f"[Source: {row.original_name}]\n{row.content}")

    return "\n\n---\n\n".join(parts)
