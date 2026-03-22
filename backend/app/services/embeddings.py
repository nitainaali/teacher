from typing import List
import asyncio

# Intentionally NOT imported at module level — sentence_transformers pulls in torch (~200 MB)
# and transformers (~150 MB) the moment it is imported, even before any model is loaded.
# On Railway's free tier (512 MB RAM) that alone can push the process over the memory limit
# and cause it to be killed before it ever serves a request.
# By deferring the import to _get_model() we keep startup RAM at ~150 MB.
_model: object | None = None


def _get_model():
    global _model
    if _model is None:
        # Lazy import — torch is only loaded into memory when the first embedding is requested
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
        # paraphrase-multilingual-MiniLM-L12-v2: 384-dim, 50+ languages including Hebrew
        # Replaces English-only all-MiniLM-L6-v2 to fix RAG quality for Hebrew content
        _model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    return _model


async def embed_text(text: str) -> List[float]:
    loop = asyncio.get_event_loop()
    model = _get_model()
    result = await loop.run_in_executor(None, lambda: model.encode(text).tolist())
    return result


async def embed_texts(texts: List[str]) -> List[List[float]]:
    loop = asyncio.get_event_loop()
    model = _get_model()
    result = await loop.run_in_executor(None, lambda: model.encode(texts).tolist())
    return result


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping word-based chunks."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks
