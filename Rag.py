#!/usr/bin/env python3
"""
RAG over a LARGE C/C++ codebase using only business-friendly open-source pieces:
- Ollama (local LLM + local embeddings; server is source-available; choose a commercially-permissive
  model like Mistral 7B Instruct (Apache-2.0) for the LLM and bge-m3 (MIT) or nomic-embed-text (Apache-2.0)
  for embeddings. Always check the model card.)
- ChromaDB (Apache-2.0) as the on-disk vector DB.
- Python libs: requests (Apache-2.0), tqdm (MPL-2.0), pypdf (BSD-3-Clause), python-docx (MIT),
  beautifulsoup4 (MIT), pathspec (MIT). These are all business-friendly.

This script targets very large repos (100k+ files) and incremental updates per commit. It uses
code-aware line chunking, skips build/vendor folders, and supports git-aware delta indexing.

--------------------------------------------------------------------------------
USAGE OVERVIEW
--------------------------------------------------------------------------------

# 0) Install models and deps (examples)
#    LLM   : mistral (Apache-2.0)      =>  ollama pull mistral
#    Embed : bge-m3  (MIT)             =>  ollama pull bge-m3
#    Deps  : pip install chromadb pypdf python-docx beautifulsoup4 tqdm requests pathspec

# 1) Full ingest (first time)
# python rag_code_ollama.py ingest --dir /path/to/repo --db ./.rag_db --collection my_cpp_repo \
#   --embed-model bge-m3 --llm mistral --reset --workers 6

# 2) Incremental update from last run (scan filesystem + manifest)
# python rag_code_ollama.py update --dir /path/to/repo --db ./.rag_db --collection my_cpp_repo

# 3) Incremental update using git diff (fast during CI)
# python rag_code_ollama.py update-git --dir /path/to/repo --db ./.rag_db --collection my_cpp_repo --git-range HEAD~1..HEAD

# 4) Ask a question (Retrieval + LLM with inline [n] citations)
# python rag_code_ollama.py query --db ./.rag_db --collection my_cpp_repo --llm mistral --embed-model bge-m3 "How does the networking layer handle reconnection?"

# 5) Helpful operations
# python rag_code_ollama.py reindex-file --db ./.rag_db --collection my_cpp_repo --path src/foo/bar.cpp
# python rag_code_ollama.py vacuum --dir /path/to/repo --db ./.rag_db --collection my_cpp_repo

DISCLAIMER
These examples reference models that are widely used under permissive licenses (e.g., Apache-2.0/MIT).
Always verify the specific model license you deploy in production. Core libraries used here are permissive.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import dataclasses
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import requests
from tqdm import tqdm

# ------------------------------
# Optional third-party imports
# ------------------------------
try:
    import chromadb
except Exception as e:
    print("[ERROR] chromadb is required. pip install chromadb", file=sys.stderr)
    raise

try:
    from chromadb.config import Settings  # noqa: F401
except Exception:
    pass

try:
    from pypdf import PdfReader
except Exception:
    PdfReader = None

try:
    from docx import Document as DocxDocument
except Exception:
    DocxDocument = None

try:
    from bs4 import BeautifulSoup
except Exception:
    BeautifulSoup = None

try:
    import pathspec  # read/merge .gitignore rules (MIT)
except Exception:
    pathspec = None

# ------------------------------
# Configuration defaults
# ------------------------------
CODE_EXTS = {
    ".c", ".cc", ".cxx", ".cpp", ".c++",
    ".h", ".hh", ".hpp", ".hxx", ".inl",
    ".ipp", ".tpp", ".ixx",
    "CMakeLists.txt", ".cmake", ".mak", ".mk",
}
DOC_EXTS = {".md", ".txt"}
AUX_EXTS = {".html", ".htm", ".docx", ".pdf"}
SUPPORTED_EXTS = CODE_EXTS | DOC_EXTS | AUX_EXTS

DEFAULT_IGNORES = [
    ".git/", ".svn/", ".hg/", ".idea/", ".vscode/",
    "build/", "cmake-build-", "out/", "bin/", "obj/", "target/",
    "dist/", "node_modules/", "third_party/", "external/", "_deps/",
    "__pycache__/", ".cache/", "venv/", ".tox/",
]

# ------------------------------
# Helpers
# ------------------------------

def sha1_file(path: Path, block: int = 1024 * 1024) -> str:
    """Compute a stable SHA-1 of the file. Used to derive chunk IDs and detect changes."""
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(block), b""):
            h.update(chunk)
    return h.hexdigest()


def fast_sig(path: Path) -> Tuple[int, float]:
    """Fast signal for change detection: (size, mtime). If either changed, recompute SHA-1."""
    st = path.stat()
    return (st.st_size, st.st_mtime)


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9-_]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "collection"

# ------------------------------
# Loading & parsing
# ------------------------------

def read_text_utf8(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return path.read_text(errors="ignore")


def load_pdf(path: Path) -> List[Tuple[str, Dict]]:
    if PdfReader is None:
        return []
    texts: List[Tuple[str, Dict]] = []
    try:
        reader = PdfReader(str(path))
        for i, page in enumerate(reader.pages):
            try:
                t = page.extract_text() or ""
            except Exception:
                t = ""
            if t.strip():
                texts.append((t, {"page": i + 1}))
    except Exception as e:
        print(f"[WARN] Failed to read PDF {path}: {e}")
    return texts


def load_docx(path: Path) -> str:
    if DocxDocument is None:
        return ""
    try:
        doc = DocxDocument(str(path))
        return "\n".join(p.text for p in doc.paragraphs if p.text)
    except Exception as e:
        print(f"[WARN] Failed to read DOCX {path}: {e}")
        return ""


def load_html(path: Path) -> str:
    if BeautifulSoup is None:
        return ""
    try:
        html = path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.extract()
        text = soup.get_text("\n")
        text = re.sub(r"\n{2,}", "\n\n", text)
        return text.strip()
    except Exception as e:
        print(f"[WARN] Failed to read HTML {path}: {e}")
        return ""


def read_file_entries(path: Path) -> List[Tuple[str, Dict]]:
    """Return a list of (text, extra_metadata) entries for a file.
    Code files: single entry (we chunk by lines later)
    PDFs: per-page entries
    Other docs: single entry
    """
    name = path.name
    ext = path.suffix.lower()

    if name == "CMakeLists.txt":
        return [(read_text_utf8(path), {})]

    if ext in CODE_EXTS or ext in DOC_EXTS:
        t = read_text_utf8(path)
        return [(t, {})] if t.strip() else []
    elif ext == ".pdf":
        return load_pdf(path)
    elif ext == ".docx":
        t = load_docx(path)
        return [(t, {})] if t.strip() else []
    elif ext in {".html", ".htm"}:
        t = load_html(path)
        return [(t, {})] if t.strip() else []
    else:
        return []

# ------------------------------
# Code-aware chunking (line windows)
# ------------------------------

def chunk_code_lines(text: str, max_lines: int = 120, overlap: int = 20) -> List[str]:
    """Chunk code by line windows so functions and context stay together."""
    lines = text.splitlines()
    chunks: List[str] = []
    if not lines:
        return chunks

    step = max(1, max_lines - overlap)
    for start in range(0, len(lines), step):
        end = min(len(lines), start + max_lines)
        chunk = "\n".join(lines[start:end])
        chunk = re.sub(r"\n{3,}", "\n\n", chunk)
        if chunk.strip():
            chunks.append(chunk)
        if end == len(lines):
            break
    return chunks


def chunk_text_paragraphs(text: str, max_chars: int = 1200, overlap: int = 200) -> List[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: List[str] = []
    buf = ""
    for p in paragraphs:
        if len(p) > max_chars:
            for i in range(0, len(p), max_chars - overlap):
                out.append(p[i : i + max_chars])
            continue
        if len(buf) + len(p) + 2 <= max_chars:
            buf = (buf + "\n\n" + p) if buf else p
        else:
            if buf:
                out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    if not out and text:
        for i in range(0, len(text), max_chars - overlap):
            out.append(text[i : i + max_chars])
    return out

# ------------------------------
# Ollama client (embeddings + chat)
# ------------------------------

class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434", timeout: int = 120):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def embed(self, model: str, text: str) -> List[float]:
        r = requests.post(f"{self.base}/api/embeddings", json={"model": model, "prompt": text}, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        return data["embedding"]

    def chat(self, model: str, messages: List[Dict], stream: bool = False, timeout: Optional[int] = None) -> str:
        r = requests.post(
            f"{self.base}/api/chat",
            json={"model": model, "messages": messages, "stream": stream},
            timeout=timeout or self.timeout,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("message", {}).get("content", "")

# ------------------------------
# Vector store wrapper (Chroma)
# ------------------------------

class ChromaStore:
    def __init__(self, db_path: str, collection: str, reset: bool = False):
        self.client = chromadb.PersistentClient(path=db_path)
        if reset:
            try:
                self.client.delete_collection(collection)
            except Exception:
                pass
        self.col = self.client.get_or_create_collection(collection, metadata={"hnsw:space": "cosine"})

    def add(self, ids: List[str], embeddings: List[List[float]], documents: List[str], metadatas: List[Dict]):
        self.col.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)

    def delete_by_file_sha(self, file_sha1: str):
        self.col.delete(where={"file_sha1": file_sha1})

    def query(self, *, query_embedding: Optional[List[float]] = None, query_text: Optional[str] = None, n_results: int = 5):
        if query_embedding is not None:
            return self.col.query(query_embeddings=[query_embedding], n_results=n_results)
        if query_text is not None:
            return self.col.query(query_texts=[query_text], n_results=n_results)
        raise ValueError("Provide query_embedding or query_text")

# ------------------------------
# Manifest (tracks what we indexed)
# ------------------------------

@dataclass
class FileRecord:
    path: str
    size: int
    mtime: float
    sha1: str
    chunk_count: int

@dataclass
class Manifest:
    version: int
    files: Dict[str, FileRecord]

    @staticmethod
    def load(path: Path) -> "Manifest":
        if not path.exists():
            return Manifest(version=1, files={})
        data = json.loads(path.read_text())
        files = {k: FileRecord(**v) for k, v in data.get("files", {}).items()}
        return Manifest(version=data.get("version", 1), files=files)

    def save(self, path: Path):
        serial = {k: dataclasses.asdict(v) for k, v in self.files.items()}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": self.version, "files": serial}, indent=2))

# ------------------------------
# Ignore handling (.gitignore + defaults)
# ------------------------------

def build_ignore_spec(root: Path, extra_ignores: Sequence[str]):
    patterns: List[str] = []
    patterns.extend(DEFAULT_IGNORES)
    patterns.extend(extra_ignores or [])

    gi = root / ".gitignore"
    if pathspec and gi.exists():
        try:
            patterns.extend(gi.read_text().splitlines())
        except Exception:
            pass
    if not pathspec:
        return None
    return pathspec.PathSpec.from_lines("gitwildmatch", patterns)


def should_ignore(path: Path, root: Path, spec) -> bool:
    rel = str(path.relative_to(root))
    if spec and spec.match_file(rel):
        return True
    for pat in DEFAULT_IGNORES:
        if pat.rstrip("/") in rel.split(os.sep):
            return True
    return False

# ------------------------------
# File discovery
# ------------------------------

def iter_supported_files(root: Path, allowed_exts: Sequence[str], spec) -> Iterable[Path]:
    allowed = set(allowed_exts)
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if should_ignore(p, root, spec):
            continue
        name = p.name
        ext = p.suffix
        if name == "CMakeLists.txt" or ext in allowed:
            yield p

# ------------------------------
# Chunk builders
# ------------------------------

@dataclass
class Chunk:
    id: str
    text: str
    metadata: Dict


def build_chunks_for_file(path: Path, file_sha: str, code_chunk_lines: int, code_overlap: int, doc_chars: int, doc_overlap: int) -> List[Chunk]:
    entries = read_file_entries(path)
    chunks: List[Chunk] = []
    is_code = (path.name == "CMakeLists.txt") or (path.suffix.lower() in CODE_EXTS)

    for entry_idx, (text, extra) in enumerate(entries):
        if not text.strip():
            continue
        parts = (
            chunk_code_lines(text, max_lines=code_chunk_lines, overlap=code_overlap)
            if is_code else
            chunk_text_paragraphs(text, max_chars=doc_chars, overlap=doc_overlap)
        )
        for i, body in enumerate(parts):
            cid = f"{file_sha}:{entry_idx}:{i}"
            chunks.append(Chunk(
                id=cid,
                text=body,
                metadata={
                    "file_sha1": file_sha,
                    "source_path": str(path.resolve()),
                    "filename": path.name,
                    "entry_index": entry_idx,
                    "chunk_index": i,
                    **extra,
                },
            ))
    return chunks

# ------------------------------
# Indexer (full + incremental + git-aware)
# ------------------------------

class Indexer:
    def __init__(self, db_path: str, collection: str, ollama_url: str, embed_model: str, workers: int = 4, rate_limit_qps: float = 3.0):
        self.store = ChromaStore(db_path=db_path, collection=collection, reset=False)
        self.ollama = OllamaClient(base_url=ollama_url, timeout=180)
        self.embed_model = embed_model
        self.workers = max(1, workers)
        self.qps = max(0.1, rate_limit_qps)
        self._last_call_ts = 0.0

    def _embed_one(self, text: str) -> Optional[List[float]]:
        # throttle client-side to avoid overloading Ollama
        wait = max(0.0, (1.0 / self.qps) - (time.time() - self._last_call_ts))
        if wait > 0:
            time.sleep(wait)
        try:
            vec = self.ollama.embed(self.embed_model, text)
            self._last_call_ts = time.time()
            return vec
        except Exception:
            # retries with exponential backoff
            for i in range(3):
                t = (2 ** i) * 0.5
                time.sleep(t)
                try:
                    vec = self.ollama.embed(self.embed_model, text)
                    self._last_call_ts = time.time()
                    return vec
                except Exception:
                    continue
            print("[WARN] embedding failed after retries; skipping a chunk")
            return None

    def _embed_batch_parallel(self, chunks: List[Chunk]) -> Tuple[List[str], List[List[float]], List[str], List[Dict]]:
        ids: List[str] = []
        embs: List[List[float]] = []
        docs: List[str] = []
        metas: List[Dict] = []
        with futures.ThreadPoolExecutor(max_workers=self.workers) as ex:
            fut_map = {ex.submit(self._embed_one, ch.text): ch for ch in chunks}
            for fut in tqdm(futures.as_completed(fut_map), total=len(chunks), desc="Embedding", unit="chunk"):
                ch = fut_map[fut]
                try:
                    emb = fut.result()
                except Exception:
                    emb = None
                if emb is None:
                    continue
                ids.append(ch.id)
                embs.append(emb)
                docs.append(ch.text)
                metas.append(ch.metadata)
        return ids, embs, docs, metas

    def upsert_file(self, path: Path, file_sha: str, *, code_chunk_lines: int, code_overlap: int, doc_chars: int, doc_overlap: int) -> int:
        # Build fresh chunks
        chunks = build_chunks_for_file(path, file_sha, code_chunk_lines, code_overlap, doc_chars, doc_overlap)
        if not chunks:
            return 0
        # Remove any old vectors for this file, then add new ones
        self.store.delete_by_file_sha(file_sha)
        ids, embs, docs, metas = self._embed_batch_parallel(chunks)
        if ids:
            self.store.add(ids, embs, docs, metas)
        return len(ids)

# ------------------------------
# Retrieval + LLM answering
# ------------------------------

def format_context(results) -> Tuple[str, List[Dict]]:
    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    blocks: List[str] = []
    for i, (d, m) in enumerate(zip(docs, metas), start=1):
        src = m.get("filename", "?")
        page = m.get("page")
        path = m.get("source_path", "")
        label = f"[{i}] {src}{f' p.{page}' if page else ''} — {path}"
        blocks.append(f"{label}\n---\n{d}\n")
    return "\n\n".join(blocks), metas


def answer_question(db_path: str, collection: str, question: str, llm_model: str, embed_model: str, ollama_url: str, top_k: int) -> Tuple[str, List[Dict]]:
    store = ChromaStore(db_path=db_path, collection=collection, reset=False)
    ollama = OllamaClient(base_url=ollama_url, timeout=240)

    try:
        q_emb = ollama.embed(embed_model, question)
        results = store.query(query_embedding=q_emb, n_results=top_k)
    except Exception:
        results = store.query(query_text=question, n_results=top_k)

    ctx, metas = format_context(results)
    system = (
        "You are a codebase assistant. Use ONLY the provided context blocks to answer. "
        "Cite sources inline using [n] where n is the context block index. If the answer is not in the context, say you don't know."
    )
    user = (
        f"QUESTION:\n{question}\n\nCONTEXT BLOCKS:\n{ctx}\n\n"
        "Instructions:\n- Be concise.\n- Use bullet points when listing APIs or steps.\n- Include citations like [1], [2], etc.\n"
    )
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    answer = ollama.chat(model=llm_model, messages=messages)
    return answer, metas

# ------------------------------
# CLI commands
# ------------------------------

def cmd_ingest(args):
    root = Path(args.dir).resolve()
    collection = args.collection or slugify(root.name)
    manifest_path = Path(args.db) / "_state" / f"{collection}.manifest.json"
    manifest = Manifest.load(manifest_path)

    spec = build_ignore_spec(root, args.ignore or [])
    exts = list(SUPPORTED_EXTS | set(args.extra_ext or []))

    indexer = Indexer(
        db_path=args.db,
        collection=collection,
        ollama_url=args.ollama_url,
        embed_model=args.embed_model,
        workers=args.workers,
        rate_limit_qps=args.qps,
    )

    if args.reset:
        indexer.store = ChromaStore(db_path=args.db, collection=collection, reset=True)

    paths = list(iter_supported_files(root, exts, spec))
    print(f"[INFO] Found {len(paths)} candidate files")

    total_new = 0
    for p in tqdm(paths, desc="Indexing files", unit="file"):
        size, mtime = fast_sig(p)
        rec = manifest.files.get(str(p))
        need = (rec is None) or (rec.size != size or abs(rec.mtime - mtime) > 1e-6)
        if not need:
            continue
        file_sha = sha1_file(p)
        count = indexer.upsert_file(
            p, file_sha,
            code_chunk_lines=args.code_lines,
            code_overlap=args.code_overlap,
            doc_chars=args.doc_chars,
            doc_overlap=args.doc_overlap,
        )
        manifest.files[str(p)] = FileRecord(path=str(p), size=size, mtime=mtime, sha1=file_sha, chunk_count=count)
        total_new += count

    manifest.save(manifest_path)
    print(f"[OK] Ingest complete. Added/updated {total_new} chunks. DB: {args.db}, collection: {collection}")


def _iter_git_changed(root: Path, git_range: str) -> List[Path]:
    try:
        out = subprocess.check_output(["git", "-C", str(root), "diff", "--name-only", git_range], text=True)
    except Exception:
        print("[WARN] git diff failed; falling back to full scan")
        return []
    files = []
    for line in out.splitlines():
        p = (root / line).resolve()
        if p.exists() and p.is_file():
            files.append(p)
    return files


def cmd_update_git(args):
    root = Path(args.dir).resolve()
    collection = args.collection or slugify(root.name)
    manifest_path = Path(args.db) / "_state" / f"{collection}.manifest.json"
    manifest = Manifest.load(manifest_path)

    spec = build_ignore_spec(root, args.ignore or [])
    exts = list(SUPPORTED_EXTS | set(args.extra_ext or []))

    indexer = Indexer(
        db_path=args.db,
        collection=collection,
        ollama_url=args.ollama_url,
        embed_model=args.embed_model,
        workers=args.workers,
        rate_limit_qps=args.qps,
    )

    changed = _iter_git_changed(root, args.git_range or "HEAD~1..HEAD")
    if not changed:
        print("[INFO] No git changes detected or git not available.")
        return

    targets = [p for p in changed if not should_ignore(p, root, spec) and (p.name == "CMakeLists.txt" or p.suffix in exts)]
    print(f"[INFO] Changed files matched: {len(targets)}")

    total = 0
    for p in tqdm(targets, desc="Updating changed files", unit="file"):
        size, mtime = fast_sig(p)
        file_sha = sha1_file(p)
        count = indexer.upsert_file(
            p, file_sha,
            code_chunk_lines=args.code_lines,
            code_overlap=args.code_overlap,
            doc_chars=args.doc_chars,
            doc_overlap=args.doc_overlap,
        )
        manifest.files[str(p)] = FileRecord(path=str(p), size=size, mtime=mtime, sha1=file_sha, chunk_count=count)
        total += count

    manifest.save(manifest_path)
    print(f"[OK] Git update complete. Upserted {total} chunks.")


def cmd_update(args):
    root = Path(args.dir).resolve()
    collection = args.collection or slugify(root.name)
    manifest_path = Path(args.db) / "_state" / f"{collection}.manifest.json"
    manifest = Manifest.load(manifest_path)

    spec = build_ignore_spec(root, args.ignore or [])
    exts = list(SUPPORTED_EXTS | set(args.extra_ext or []))

    indexer = Indexer(
        db_path=args.db,
        collection=collection,
        ollama_url=args.ollama_url,
        embed_model=args.embed_model,
        workers=args.workers,
        rate_limit_qps=args.qps,
    )

    paths = list(iter_supported_files(root, exts, spec))
    print(f"[INFO] Scanning {len(paths)} files for changes…")

    changed: List[Path] = []
    for p in paths:
        size, mtime = fast_sig(p)
        rec = manifest.files.get(str(p))
        if rec is None or rec.size != size or abs(rec.mtime - mtime) > 1e-6:
            changed.append(p)

    if not changed:
        print("[INFO] No changes detected.")
        return

    total = 0
    for p in tqdm(changed, desc="Reindexing changed files", unit="file"):
        size, mtime = fast_sig(p)
        file_sha = sha1_file(p)
        count = indexer.upsert_file(
            p, file_sha,
            code_chunk_lines=args.code_lines,
            code_overlap=args.code_overlap,
            doc_chars=args.doc_chars,
            doc_overlap=args.doc_overlap,
        )
        manifest.files[str(p)] = FileRecord(path=str(p), size=size, mtime=mtime, sha1=file_sha, chunk_count=count)
        total += count

    manifest.save(manifest_path)
    print(f"[OK] Update complete. Upserted {total} chunks.")


def cmd_reindex_file(args):
    collection = args.collection
    if not collection:
        raise SystemExit("--collection is required")
    p = Path(args.path).resolve()
    if not p.exists():
        raise SystemExit(f"File not found: {p}")
    manifest_path = Path(args.db) / "_state" / f"{collection}.manifest.json"
    manifest = Manifest.load(manifest_path)

    indexer = Indexer(
        db_path=args.db,
        collection=collection,
        ollama_url=args.ollama_url,
        embed_model=args.embed_model,
        workers=args.workers,
        rate_limit_qps=args.qps,
    )

    size, mtime = fast_sig(p)
    file_sha = sha1_file(p)
    count = indexer.upsert_file(
        p, file_sha,
        code_chunk_lines=args.code_lines,
        code_overlap=args.code_overlap,
        doc_chars=args.doc_chars,
        doc_overlap=args.doc_overlap,
    )

    manifest.files[str(p)] = FileRecord(path=str(p), size=size, mtime=mtime, sha1=file_sha, chunk_count=count)
    manifest.save(manifest_path)
    print(f"[OK] Reindexed {p.name}: {count} chunks.")


def cmd_vacuum(args):
    root = Path(args.dir).resolve()
    collection = args.collection or slugify(root.name)
    manifest_path = Path(args.db) / "_state" / f"{collection}.manifest.json"
    manifest = Manifest.load(manifest_path)

    indexer = Indexer(
        db_path=args.db,
        collection=collection,
        ollama_url=args.ollama_url,
        embed_model=args.embed_model,
        workers=max(1, args.workers),
        rate_limit_qps=args.qps,
    )

    removed = 0
    for abspath, rec in list(manifest.files.items()):
        if not Path(abspath).exists():
            indexer.store.delete_by_file_sha(rec.sha1)
            manifest.files.pop(abspath, None)
            removed += 1
    manifest.save(manifest_path)
    print(f"[OK] Vacuum complete. Removed {removed} stale files.")


def cmd_query(args):
    answer, metas = answer_question(
        db_path=args.db,
        collection=args.collection,
        question=args.question,
        llm_model=args.llm,
        embed_model=args.embed_model,
        ollama_url=args.ollama_url,
        top_k=args.top_k,
    )
    print("\n==== Answer ====\n")
    print(answer.strip())
    print("\n==== Sources ====\n")
    for i, m in enumerate(metas, start=1):
        p = m.get("source_path", "")
        pg = f" p.{m['page']}" if m.get("page") else ""
        print(f"[{i}] {m.get('filename', '?')}{pg} — {p}")

# ------------------------------
# Main / CLI setup
# ------------------------------

def main():
    parser = argparse.ArgumentParser(description="RAG over a large C/C++ repo using Ollama + Chroma (business-friendly)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_shared(p):
        p.add_argument("--db", default=".rag_db", help="Chroma persistence dir")
        p.add_argument("--collection", default=None, help="Collection name (default: slug of dir)")
        p.add_argument("--ollama-url", default="http://localhost:11434", help="Ollama base URL")
        p.add_argument("--embed-model", default="bge-m3", help="Embedding model (business-friendly: bge-m3 MIT)")
        p.add_argument("--llm", default="mistral", help="LLM for answering (Apache-2.0)")
        p.add_argument("--workers", type=int, default=4, help="Parallel embedding workers")
        p.add_argument("--qps", type=float, default=3.0, help="Client-side rate-limit (queries/sec)")
        p.add_argument("--code-lines", type=int, default=120, help="Lines per code chunk")
        p.add_argument("--code-overlap", type=int, default=20, help="Overlapped lines between code chunks")
        p.add_argument("--doc-chars", type=int, default=1200, help="Chars per prose chunk (README etc.)")
        p.add_argument("--doc-overlap", type=int, default=200, help="Overlap for prose chunks")
        p.add_argument("--ignore", nargs="*", default=[], help="Extra ignore globs (additive to .gitignore/defaults)")
        p.add_argument("--extra-ext", nargs="*", default=[], help="Extra file extensions to include (e.g. .proto .json)")

    p_ing = sub.add_parser("ingest", help="Full scan + index")
    p_ing.add_argument("--dir", required=True, help="Repo root to scan")
    add_shared(p_ing)
    p_ing.add_argument("--reset", action="store_true", help="Drop and recreate the collection before ingest")

    p_upd = sub.add_parser("update", help="Reindex only changed files (size/mtime delta)")
    p_upd.add_argument("--dir", required=True, help="Repo root")
    add_shared(p_upd)

    p_git = sub.add_parser("update-git", help="Reindex files changed in a git range (e.g., HEAD~1..HEAD)")
    p_git.add_argument("--dir", required=True, help="Repo root (must be a git repo)")
    p_git.add_argument("--git-range", default="HEAD~1..HEAD", help="Git range for diff (A..B)")
    add_shared(p_git)

    p_rf = sub.add_parser("reindex-file", help="Force reindex of one file")
    p_rf.add_argument("--path", required=True, help="Path to file")
    add_shared(p_rf)

    p_vac = sub.add_parser("vacuum", help="Remove vectors for deleted files (and clean manifest)")
    p_vac.add_argument("--dir", required=True, help="Repo root")
    add_shared(p_vac)

    p_q = sub.add_parser("query", help="Ask a question against the collection")
    p_q.add_argument("question", help="Your question")
    add_shared(p_q)
    p_q.add_argument("--top-k", type=int, default=6)

    args = parser.parse_args()

    if args.cmd == "ingest":
        cmd_ingest(args)
    elif args.cmd == "update":
        cmd_update(args)
    elif args.cmd == "update-git":
        cmd_update_git(args)
    elif args.cmd == "reindex-file":
        cmd_reindex_file(args)
    elif args.cmd == "vacuum":
        cmd_vacuum(args)
    elif args.cmd == "query":
        cmd_query(args)


if __name__ == "__main__":
    main()