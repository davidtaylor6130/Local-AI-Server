#include "../include/util.hpp"
#include <openssl/sha.h>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <unordered_set>
#include <cmath>

std::string getenv_or(const char* key, const std::string& def) {
    const char* v = std::getenv(key);
    return v ? std::string(v) : def;
}

std::string sha1_file(const std::filesystem::path& p) {
    std::ifstream f(p, std::ios::binary);
    SHA_CTX ctx;
    SHA1_Init(&ctx);
    char buf[1 << 16];
    while (f) {
        f.read(buf, sizeof(buf));
        std::streamsize n = f.gcount();
        if (n > 0) SHA1_Update(&ctx, buf, (size_t)n);
    }
    unsigned char md[SHA_DIGEST_LENGTH];
    SHA1_Final(md, &ctx);
    std::ostringstream oss;
    for (int i = 0; i < SHA_DIGEST_LENGTH; ++i) {
        oss << std::hex << std::nouppercase << ((md[i] >> 4) & 0xF) << (md[i] & 0xF);
    }
    return oss.str();
}

std::string read_text_file(const std::filesystem::path& p) {
    std::ifstream f(p);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

std::vector<std::filesystem::path> list_files(const std::filesystem::path& root,
                                              const std::vector<std::string>& exts,
                                              const std::vector<std::string>& ignore_dirs) {
    std::vector<std::filesystem::path> out;
    auto extset = std::unordered_set<std::string>(exts.begin(), exts.end());
    auto igset = std::unordered_set<std::string>(ignore_dirs.begin(), ignore_dirs.end());
    for (auto& entry : std::filesystem::recursive_directory_iterator(root)) {
        if (!entry.is_regular_file()) continue;
        auto rel = std::filesystem::relative(entry.path(), root);
        bool ignored = false;
        for (auto& part : rel) {
            if (igset.count(part.string())) { ignored = true; break; }
        }
        if (ignored) continue;
        auto ext = entry.path().extension().string();
        if (extset.empty() || extset.count(ext)) out.push_back(entry.path());
    }
    return out;
}

std::vector<std::string> chunk_code_lines(const std::string& text, int max_lines, int overlap) {
    std::vector<std::string> chunks;
    std::vector<std::string> lines;
    {
        std::stringstream ss(text);
        std::string line;
        while (std::getline(ss, line)) lines.push_back(line);
    }
    if (lines.empty()) return chunks;
    int step = std::max(1, max_lines - overlap);
    for (int i = 0; i < (int)lines.size(); i += step) {
        int end = std::min<int>(lines.size(), i + max_lines);
        std::ostringstream os;
        for (int j = i; j < end; ++j) {
            os << lines[j] << '\n';
        }
        auto s = os.str();
        if (!s.empty()) chunks.push_back(std::move(s));
        if (end == (int)lines.size()) break;
    }
    return chunks;
}

std::vector<std::string> chunk_text_paragraphs(const std::string& text, int max_chars, int overlap) {
    std::vector<std::string> out;
    std::string buf;
    auto push = [&](const std::string& s){ if (!s.empty()) out.push_back(s); };
    size_t pos = 0, n = text.size();
    while (pos < n) {
        size_t next = text.find("\n\n", pos);
        std::string p = text.substr(pos, next == std::string::npos ? n - pos : next - pos);
        if ((int)(buf.size() + p.size()) + 2 <= max_chars) {
            buf += (buf.empty() ? "" : "\n\n");
            buf += p;
        } else {
            push(buf);
            buf = p;
        }
        if (next == std::string::npos) break;
        pos = next + 2;
    }
    if (!buf.empty()) push(buf);
    if (out.empty() && !text.empty()) {
        for (size_t i = 0; i < text.size(); i += (max_chars - overlap)) {
            out.push_back(text.substr(i, max_chars));
        }
    }
    return out;
}

float cosine_similarity(const std::vector<float>& a, const std::vector<float>& b) {
    if (a.size() != b.size() || a.empty()) return 0.0f;
    double dot = 0.0, na = 0.0, nb = 0.0;
    for (size_t i = 0; i < a.size(); ++i) {
        dot += (double)a[i] * (double)b[i];
        na += (double)a[i] * (double)a[i];
        nb += (double)b[i] * (double)b[i];
    }
    if (na == 0.0 || nb == 0.0) return 0.0f;
    return (float)(dot / (std::sqrt(na) * std::sqrt(nb)));
}
