#pragma once
#include <string>
#include <vector>
#include <filesystem>

std::string getenv_or(const char* key, const std::string& def);
std::string sha1_file(const std::filesystem::path& p);
std::vector<std::filesystem::path> list_files(const std::filesystem::path& root,
                                              const std::vector<std::string>& exts,
                                              const std::vector<std::string>& ignore_dirs);
std::string read_text_file(const std::filesystem::path& p);
std::vector<std::string> chunk_code_lines(const std::string& text, int max_lines, int overlap);
std::vector<std::string> chunk_text_paragraphs(const std::string& text, int max_chars, int overlap);
float cosine_similarity(const std::vector<float>& a, const std::vector<float>& b);

