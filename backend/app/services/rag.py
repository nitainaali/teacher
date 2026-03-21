from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.services.embeddings import embed_text
from typing import Optional, List


async def retrieve_context(
    db: AsyncSession,
    query: str,
    course_id: Optional[str] = None,
    top_k: int = 5,
    upload_source: Optional[str] = None,
    active_shared_course_ids: Optional[List[str]] = None,
) -> str:
    """
    Embed query, search pgvector for nearest chunks filtered by course_id.
    Optionally restrict to a specific upload_source (e.g. 'knowledge' to exclude
    exam documents from topic-summary RAG lookups).
    Optionally UNION with shared_document_chunks for active shared courses.
    Returns formatted context string.
    """
    query_embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # Build WHERE clause for user's own documents
    where_parts = []
    params: dict = {"embedding": embedding_str, "top_k": top_k}
    if course_id:
        where_parts.append("d.course_id = :course_id")
        params["course_id"] = course_id
    if upload_source:
        where_parts.append("d.upload_source = :upload_source")
        params["upload_source"] = upload_source

    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # Base query: user's own document chunks
    own_sql = f"""
        SELECT dc.content, dc.chunk_index, d.original_name,
               dc.embedding <=> CAST(:embedding AS vector) AS distance
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        {where_clause}
    """

    if active_shared_course_ids:
        # Build shared chunk query
        shared_ids_str = ",".join(f"'{sid}'" for sid in active_shared_course_ids)
        shared_sql = f"""
        SELECT sdc.content, sdc.chunk_index, sd.original_name,
               sdc.embedding <=> CAST(:embedding AS vector) AS distance
        FROM shared_document_chunks sdc
        JOIN shared_documents sd ON sdc.shared_document_id = sd.id
        WHERE sd.shared_course_id IN ({shared_ids_str})
          AND sd.processing_status = 'done'
        """
        combined_sql = text(f"""
            SELECT content, chunk_index, original_name, distance FROM (
                {own_sql}
                UNION ALL
                {shared_sql}
            ) combined
            ORDER BY distance
            LIMIT :top_k
        """)
    else:
        combined_sql = text(f"""
            {own_sql}
            ORDER BY dc.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)

    rows = await db.execute(combined_sql, params)

    chunks = rows.fetchall()
    if not chunks:
        return ""

    parts = []
    for row in chunks:
        parts.append(f"[Source: {row.original_name}]\n{row.content}")

    return "\n\n---\n\n".join(parts)
