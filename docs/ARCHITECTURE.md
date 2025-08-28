# Architecture Overview

- Ollama: core LLM runtime and embeddings provider.
- Queue (C++): in-memory priority queue with High/Low lanes. Agents pull work; API enqueues.
- Queue HTTP API (C++/libmicrohttpd): client-facing endpoints to enqueue/dequeue/complete tasks.
- RAG Agent (C++): indexes `knowledge/` and persists vectors in SQLite; answers via Ollama with citations.

Message Flow
- Client -> API Gateway -> Queue (enqueue)
- Agent -> Queue (dequeue/poll) -> Agent performs task -> Queue/API (result)

Why C++ for queue
- Fine-grained control over concurrency, memory, and future performance goals.

Why Python for RAG
- Still useful for rapid prototyping and rich parsing libraries if needed.

Why C++ for RAG
- Native performance and debuggability; simple deployment with SQLite; future swap-in of FAISS or Qdrant when scale demands.
