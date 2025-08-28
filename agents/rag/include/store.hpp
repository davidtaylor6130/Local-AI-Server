#pragma once
#include <string>
#include <vector>
#include <optional>

struct ChunkMeta {
    std::string id;
    std::string file_sha;
    std::string source_path;
    std::string filename;
    int entry_index{0};
    int chunk_index{0};
    std::string text;
};

struct ScoredChunk {
    ChunkMeta meta;
    float score{0.0f};
};

class RagStore {
public:
    RagStore(const std::string& db_path);
    ~RagStore();

    void reset();
    void upsert_file(const std::string& file_sha,
                     const std::string& path,
                     const std::string& filename,
                     const std::vector<std::string>& chunks,
                     const std::vector<std::vector<float>>& embeddings);

    std::vector<ScoredChunk> topk_by_embedding(const std::vector<float>& query, int top_k);

private:
    void init();
    void exec(const std::string& sql);
    void prepare_statements();
    void close_statements();

    struct sqlite3* db_ {nullptr};
    struct sqlite3_stmt* insert_stmt_ {nullptr};
    struct sqlite3_stmt* delete_by_sha_stmt_ {nullptr};
    struct sqlite3_stmt* all_stmt_ {nullptr};
};
