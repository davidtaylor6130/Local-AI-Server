#include "../include/store.hpp"
#include "../include/util.hpp"
#include <sqlite3.h>
#include <stdexcept>
#include <cstring>
#include <algorithm>

static void bind_text(sqlite3_stmt* st, int idx, const std::string& v) {
    sqlite3_bind_text(st, idx, v.c_str(), (int)v.size(), SQLITE_TRANSIENT);
}

static void bind_blob(sqlite3_stmt* st, int idx, const std::vector<float>& v) {
    sqlite3_bind_blob(st, idx, v.data(), (int)(v.size() * sizeof(float)), SQLITE_TRANSIENT);
}

RagStore::RagStore(const std::string& db_path) {
    if (sqlite3_open(db_path.c_str(), &db_) != SQLITE_OK) {
        throw std::runtime_error("Failed to open SQLite DB: " + db_path);
    }
    init();
    prepare_statements();
}

RagStore::~RagStore() {
    close_statements();
    if (db_) sqlite3_close(db_);
}

void RagStore::init() {
    exec("PRAGMA journal_mode=WAL;");
    exec("CREATE TABLE IF NOT EXISTS chunks (\n"
         "  id TEXT PRIMARY KEY,\n"
         "  file_sha TEXT,\n"
         "  source_path TEXT,\n"
         "  filename TEXT,\n"
         "  entry_index INTEGER,\n"
         "  chunk_index INTEGER,\n"
         "  text TEXT,\n"
         "  vector BLOB\n"
         ");");
    exec("CREATE INDEX IF NOT EXISTS idx_chunks_file_sha ON chunks(file_sha);");
}

void RagStore::exec(const std::string& sql) {
    char* err = nullptr;
    if (sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
        std::string msg = err ? err : "unknown";
        sqlite3_free(err);
        throw std::runtime_error("SQLite error: " + msg);
    }
}

void RagStore::prepare_statements() {
    const char* ins = "INSERT OR REPLACE INTO chunks \n"
                      "(id, file_sha, source_path, filename, entry_index, chunk_index, text, vector) \n"
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?);";
    if (sqlite3_prepare_v2(db_, ins, -1, &insert_stmt_, nullptr) != SQLITE_OK) {
        throw std::runtime_error("prepare insert failed");
    }
    const char* del = "DELETE FROM chunks WHERE file_sha = ?;";
    if (sqlite3_prepare_v2(db_, del, -1, &delete_by_sha_stmt_, nullptr) != SQLITE_OK) {
        throw std::runtime_error("prepare delete failed");
    }
    const char* all = "SELECT id, file_sha, source_path, filename, entry_index, chunk_index, text, vector FROM chunks;";
    if (sqlite3_prepare_v2(db_, all, -1, &all_stmt_, nullptr) != SQLITE_OK) {
        throw std::runtime_error("prepare select failed");
    }
}

void RagStore::close_statements() {
    if (insert_stmt_) { sqlite3_finalize(insert_stmt_); insert_stmt_ = nullptr; }
    if (delete_by_sha_stmt_) { sqlite3_finalize(delete_by_sha_stmt_); delete_by_sha_stmt_ = nullptr; }
    if (all_stmt_) { sqlite3_finalize(all_stmt_); all_stmt_ = nullptr; }
}

void RagStore::reset() {
    exec("DELETE FROM chunks;");
}

void RagStore::upsert_file(const std::string& file_sha,
                           const std::string& path,
                           const std::string& filename,
                           const std::vector<std::string>& chunks,
                           const std::vector<std::vector<float>>& embeddings) {
    // Remove prior rows for this file
    sqlite3_reset(delete_by_sha_stmt_);
    bind_text(delete_by_sha_stmt_, 1, file_sha);
    if (sqlite3_step(delete_by_sha_stmt_) != SQLITE_DONE) {
        throw std::runtime_error("delete_by_sha failed");
    }
    sqlite3_reset(delete_by_sha_stmt_);

    // Insert chunks
    for (size_t i = 0; i < chunks.size(); ++i) {
        const auto& emb = embeddings[i];
        std::string id = file_sha + ":0:" + std::to_string(i);
        sqlite3_reset(insert_stmt_);
        sqlite3_clear_bindings(insert_stmt_);
        bind_text(insert_stmt_, 1, id);
        bind_text(insert_stmt_, 2, file_sha);
        bind_text(insert_stmt_, 3, path);
        bind_text(insert_stmt_, 4, filename);
        sqlite3_bind_int(insert_stmt_, 5, 0);
        sqlite3_bind_int(insert_stmt_, 6, (int)i);
        bind_text(insert_stmt_, 7, chunks[i]);
        bind_blob(insert_stmt_, 8, emb);
        if (sqlite3_step(insert_stmt_) != SQLITE_DONE) {
            throw std::runtime_error("insert chunk failed");
        }
    }
}

std::vector<ScoredChunk> RagStore::topk_by_embedding(const std::vector<float>& query, int top_k) {
    std::vector<ScoredChunk> out;
    sqlite3_reset(all_stmt_);
    while (sqlite3_step(all_stmt_) == SQLITE_ROW) {
        ChunkMeta m;
        m.id = reinterpret_cast<const char*>(sqlite3_column_text(all_stmt_, 0));
        m.file_sha = reinterpret_cast<const char*>(sqlite3_column_text(all_stmt_, 1));
        m.source_path = reinterpret_cast<const char*>(sqlite3_column_text(all_stmt_, 2));
        m.filename = reinterpret_cast<const char*>(sqlite3_column_text(all_stmt_, 3));
        m.entry_index = sqlite3_column_int(all_stmt_, 4);
        m.chunk_index = sqlite3_column_int(all_stmt_, 5);
        m.text = reinterpret_cast<const char*>(sqlite3_column_text(all_stmt_, 6));
        const void* blob = sqlite3_column_blob(all_stmt_, 7);
        int bytes = sqlite3_column_bytes(all_stmt_, 7);
        std::vector<float> vec(bytes / (int)sizeof(float));
        std::memcpy(vec.data(), blob, bytes);
        float score = cosine_similarity(vec, query);
        out.push_back({m, score});
    }
    sqlite3_reset(all_stmt_);
    std::partial_sort(out.begin(), out.begin() + std::min<int>(top_k, (int)out.size()), out.end(),
                      [](const ScoredChunk& a, const ScoredChunk& b){ return a.score > b.score; });
    if ((int)out.size() > top_k) out.resize(top_k);
    return out;
}
