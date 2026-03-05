from sentence_transformers import SentenceTransformer
from typing import List
import asyncio

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
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
