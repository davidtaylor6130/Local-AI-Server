#include "../include/rag.hpp"
#include "../include/http.hpp"
#include "../include/util.hpp"
#include "../include/store.hpp"
#include <nlohmann/json.hpp>
#include <thread>
#include <chrono>

using json = nlohmann::json;

static std::vector<float> embed_text(const EmbedConfig& cfg, const std::string& text) {
    json body = {
        {"model", cfg.embed_model},
        {"prompt", text}
    };
    auto r = http_post_json(cfg.ollama_url + "/api/embeddings", body.dump(), cfg.timeout_ms);
    if (r.status < 200 || r.status >= 300) {
        throw std::runtime_error("embedding failed: status " + std::to_string(r.status));
    }
    auto data = json::parse(r.body);
    std::vector<float> vec;
    for (auto& v : data["embedding"]) vec.push_back(v.get<float>());
    return vec;
}

static std::string chat_answer(const LlmConfig& cfg, const std::string& system_prompt, const std::string& user_prompt) {
    json body = {
        {"model", cfg.llm_model},
        {"messages", json::array({
            json{{"role","system"},{"content",system_prompt}},
            json{{"role","user"},{"content",user_prompt}}
        })}
    };
    auto r = http_post_json(cfg.ollama_url + "/api/chat", body.dump(), cfg.timeout_ms);
    if (r.status < 200 || r.status >= 300) {
        throw std::runtime_error("chat failed: status " + std::to_string(r.status));
    }
    auto data = json::parse(r.body);
    if (data.contains("message")) return data["message"]["content"].get<std::string>();
    return {};
}

int rag_ingest(const std::string& db_path, const EmbedConfig& embed, const IngestOptions& opts) {
    std::vector<std::string> default_exts = {
        ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh", ".md", ".txt"
    };
    std::vector<std::string> ignores = opts.ignore_dirs.empty() ? std::vector<std::string>{
        ".git", ".svn", ".hg", ".idea", ".vscode", "build", "out", "bin", "obj", "node_modules", "venv", "dist", "target"
    } : opts.ignore_dirs;

    auto exts = opts.exts.empty() ? default_exts : opts.exts;
    auto paths = list_files(opts.dir, exts, ignores);

    RagStore store(db_path);
    if (opts.reset) store.reset();

    int total_chunks = 0;
    for (auto& p : paths) {
        auto text = read_text_file(p);
        if (text.empty()) continue;
        bool is_code = (p.extension() != ".md" && p.extension() != ".txt");
        auto parts = is_code ?
            chunk_code_lines(text, opts.code_lines, opts.code_overlap) :
            chunk_text_paragraphs(text, opts.doc_chars, opts.doc_overlap);
        if (parts.empty()) continue;
        std::vector<std::vector<float>> embeddings;
        embeddings.reserve(parts.size());
        for (auto& ch : parts) {
            embeddings.push_back(embed_text(embed, ch));
            std::this_thread::sleep_for(std::chrono::milliseconds((int)(1000.0f / std::max(0.1f, embed.qps))));
        }
        auto sha = sha1_file(p);
        store.upsert_file(sha, p.string(), p.filename().string(), parts, embeddings);
        total_chunks += (int)parts.size();
    }
    return total_chunks;
}

QueryResult rag_query(const std::string& db_path, const EmbedConfig& embed, const LlmConfig& llm,
                      const std::string& question, int top_k) {
    RagStore store(db_path);
    auto qvec = embed_text(embed, question);
    auto top = store.topk_by_embedding(qvec, top_k);

    std::string ctx;
    int i = 1;
    for (auto& sc : top) {
        ctx += "[" + std::to_string(i) + "] " + sc.meta.filename + " — " + sc.meta.source_path + "\n---\n" + sc.meta.text + "\n\n";
        ++i;
    }
    std::string sys = "You are a concise assistant. Use the provided context to answer. Cite sources as [n]. If unsure, say you don't know.";
    std::string user = std::string("Question: ") + question + "\n\nContext:\n" + ctx;
    auto ans = chat_answer(llm, sys, user);

    QueryResult res;
    res.answer = ans;
    for (size_t j = 0; j < top.size(); ++j) {
        QueryResultSource s;
        s.filename = top[j].meta.filename;
        s.source_path = top[j].meta.source_path;
        s.text = top[j].meta.text;
        res.sources.push_back(std::move(s));
    }
    return res;
}
