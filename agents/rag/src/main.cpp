#include "../include/rag.hpp"
#include "../include/util.hpp"
#include <iostream>
#include <filesystem>

static void usage() {
    std::cerr << "rag_cli usage:\n"
              << "  ingest --dir <path> --db <dbfile> [--reset] [--ollama <url>] [--embed-model <name>]\n"
              << "  query --db <dbfile> --question \"...\" [--ollama <url>] [--llm <name>] [--top-k N]\n";
}

int main(int argc, char** argv) {
    if (argc < 2) { usage(); return 1; }
    std::string cmd = argv[1];
    try {
        if (cmd == "ingest") {
            std::string dir;
            std::string db = getenv_or("RAG_DB_PATH", "./data/rag.db");
            bool reset = false;
            std::string ollama = getenv_or("OLLAMA_URL", "http://localhost:11434");
            std::string embed_model = getenv_or("RAG_EMBED_MODEL", "bge-m3");
            for (int i = 2; i < argc; ++i) {
                std::string a = argv[i];
                if (a == "--dir" && i + 1 < argc) dir = argv[++i];
                else if (a == "--db" && i + 1 < argc) db = argv[++i];
                else if (a == "--reset") reset = true;
                else if (a == "--ollama" && i + 1 < argc) ollama = argv[++i];
                else if (a == "--embed-model" && i + 1 < argc) embed_model = argv[++i];
            }
            if (dir.empty()) { usage(); return 2; }
            EmbedConfig e{ollama, embed_model};
            IngestOptions opts;
            opts.dir = std::filesystem::path(dir);
            opts.reset = reset;
            int n = rag_ingest(db, e, opts);
            std::cout << "[OK] Ingested chunks: " << n << "\n";
            return 0;
        } else if (cmd == "query") {
            std::string db = getenv_or("RAG_DB_PATH", "./data/rag.db");
            std::string question;
            std::string ollama = getenv_or("OLLAMA_URL", "http://localhost:11434");
            std::string embed_model = getenv_or("RAG_EMBED_MODEL", "bge-m3");
            std::string llm_model = getenv_or("RAG_LLM_MODEL", "mistral");
            int top_k = 6;
            for (int i = 2; i < argc; ++i) {
                std::string a = argv[i];
                if (a == "--db" && i + 1 < argc) db = argv[++i];
                else if (a == "--question" && i + 1 < argc) question = argv[++i];
                else if (a == "--ollama" && i + 1 < argc) ollama = argv[++i];
                else if (a == "--embed-model" && i + 1 < argc) embed_model = argv[++i];
                else if (a == "--llm" && i + 1 < argc) llm_model = argv[++i];
                else if (a == "--top-k" && i + 1 < argc) top_k = std::stoi(argv[++i]);
            }
            if (question.empty()) { usage(); return 2; }
            EmbedConfig e{ollama, embed_model};
            LlmConfig l{ollama, llm_model};
            auto res = rag_query(db, e, l, question, top_k);
            std::cout << "\n==== Answer ====\n\n" << res.answer << "\n\n";
            std::cout << "==== Sources ====\n";
            int i = 1;
            for (auto& s : res.sources) {
                std::cout << "[" << i++ << "] " << s.filename << " — " << s.source_path << "\n";
            }
            return 0;
        } else {
            usage();
            return 1;
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] " << e.what() << "\n";
        return 1;
    }
}
