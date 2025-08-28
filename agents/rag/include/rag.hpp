#pragma once
#include <string>
#include <vector>
#include <filesystem>

struct EmbedConfig {
    std::string ollama_url{"http://localhost:11434"};
    std::string embed_model{"bge-m3"};
    int timeout_ms{120000};
    int workers{1}; // reserved; current impl is single-threaded
    float qps{3.0f}; // reserved; naive sleep can be added
};

struct LlmConfig {
    std::string ollama_url{"http://localhost:11434"};
    std::string llm_model{"mistral"};
    int timeout_ms{240000};
};

struct IngestOptions {
    std::filesystem::path dir;
    std::vector<std::string> exts; // include-list; empty means default set
    std::vector<std::string> ignore_dirs; // default added if empty
    bool reset{false};
    int code_lines{120};
    int code_overlap{20};
    int doc_chars{1200};
    int doc_overlap{200};
};

struct QueryResultSource {
    std::string filename;
    std::string source_path;
    int page{0}; // reserved
    std::string text;
};

struct QueryResult {
    std::string answer;
    std::vector<QueryResultSource> sources;
};

int rag_ingest(const std::string& db_path, const EmbedConfig& embed, const IngestOptions& opts);
QueryResult rag_query(const std::string& db_path, const EmbedConfig& embed, const LlmConfig& llm,
                      const std::string& question, int top_k);
