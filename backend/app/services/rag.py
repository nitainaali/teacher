from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.services.embeddings import embed_text
from typing import Optional, List, Tuple


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


async def retrieve_context_comprehensive(
    db: AsyncSession,
    query: str,
    course_id: str,
    top_k: int = 15,
    min_per_doc: int = 2,
) -> Tuple[str, List[str]]:
    """
    Comprehensive RAG for topic summaries.

    1. Runs global top-k similarity search (gets the most relevant chunks).
    2. For each document in the course that has embeddings but is NOT yet
       represented in those top-k results, fetches its top `min_per_doc` chunks.
    3. Returns (context_string, list_of_unique_source_names).

    This ensures every uploaded lecture is represented in the context even if
    a single document dominates the global similarity ranking.
    """
    query_embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # --- Step 1: global top-k ---
    global_sql = text("""
        SELECT dc.content, dc.chunk_index, d.original_name,
               d.id AS doc_id,
               dc.embedding <=> CAST(:embedding AS vector) AS distance
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        WHERE d.course_id = :course_id
          AND d.upload_source = 'knowledge'
          AND d.processing_status = 'done'
        ORDER BY distance
        LIMIT :top_k
    """)
    rows = (await db.execute(global_sql, {
        "embedding": embedding_str,
        "course_id": course_id,
        "top_k": top_k,
    })).fetchall()

    covered_doc_ids = {row.doc_id for row in rows}
    all_rows = list(rows)

    # --- Step 2: discover all docs in the course ---
    all_docs_sql = text("""
        SELECT DISTINCT d.id AS doc_id, d.original_name
        FROM documents d
        WHERE d.course_id = :course_id
          AND d.upload_source = 'knowledge'
          AND d.processing_status = 'done'
    """)
    all_docs = (await db.execute(all_docs_sql, {"course_id": course_id})).fetchall()

    # --- Step 3: fetch min_per_doc chunks from each uncovered doc ---
    for doc in all_docs:
        if doc.doc_id in covered_doc_ids:
            continue
        per_doc_sql = text("""
            SELECT dc.content, dc.chunk_index, d.original_name,
                   d.id AS doc_id,
                   dc.embedding <=> CAST(:embedding AS vector) AS distance
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            WHERE d.id = :doc_id
            ORDER BY distance
            LIMIT :min_per_doc
        """)
        extra = (await db.execute(per_doc_sql, {
            "embedding": embedding_str,
            "doc_id": str(doc.doc_id),
            "min_per_doc": min_per_doc,
        })).fetchall()
        all_rows.extend(extra)

    if not all_rows:
        return "", []

    # Sort combined results by similarity (best first)
    all_rows.sort(key=lambda r: r.distance)

    parts = []
    source_names: List[str] = []
    seen_names: set = set()
    for row in all_rows:
        parts.append(f"[Source: {row.original_name}]\n{row.content}")
        if row.original_name not in seen_names:
            seen_names.add(row.original_name)
            source_names.append(row.original_name)

    return "\n\n---\n\n".join(parts), source_names
