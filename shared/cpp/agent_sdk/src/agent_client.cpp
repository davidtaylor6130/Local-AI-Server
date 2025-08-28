#include "../include/agent_client.hpp"
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include <stdexcept>
#include <sstream>

using json = nlohmann::json;

namespace {
static size_t write_cb(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t total = size * nmemb;
    std::string* s = static_cast<std::string*>(userp);
    s->append(static_cast<char*>(contents), total);
    return total;
}

struct CurlHandle {
    CURL* h{nullptr};
    CurlHandle() { h = curl_easy_init(); if (!h) throw std::runtime_error("curl_easy_init failed"); }
    ~CurlHandle() { if (h) curl_easy_cleanup(h); }
};
}

AgentQueueClient::AgentQueueClient(std::string base_url) : base_(std::move(base_url)) {
    if (!base_.empty() && base_.back() == '/') base_.pop_back();
}

std::optional<Task> AgentQueueClient::dequeue(const std::string& agent) {
    CurlHandle c;
    std::string url = base_ + "/dequeue?agent=" + agent; // agent names are simple; add encoding if needed
    std::string buf;
    curl_easy_setopt(c.h, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c.h, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c.h, CURLOPT_WRITEDATA, &buf);
    CURLcode code = curl_easy_perform(c.h);
    if (code != CURLE_OK) return std::nullopt;
    long status = 0;
    curl_easy_getinfo(c.h, CURLINFO_RESPONSE_CODE, &status);
    if (status == 204) return std::nullopt;
    if (status < 200 || status >= 300) return std::nullopt;
    auto j = json::parse(buf);
    Task t;
    t.id = j.at("id").get<std::string>();
    t.agent = j.at("agent").get<std::string>();
    t.model = j.at("model").get<std::string>();
    t.priority = j.value("priority", std::string("low"));
    t.payload_json = j.value("payload", json::object()).dump();
    return t;
}

bool AgentQueueClient::complete(const std::string& id, bool ok, const std::string& error) {
    CurlHandle c;
    std::string url = base_ + "/complete/" + id;
    json body = ok ? json({{"status","ok"}}) : json({{"status","error"},{"error", error}});
    std::string body_str = body.dump();

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    std::string buf;
    curl_easy_setopt(c.h, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c.h, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(c.h, CURLOPT_POSTFIELDS, body_str.c_str());
    curl_easy_setopt(c.h, CURLOPT_POSTFIELDSIZE, (long)body_str.size());
    curl_easy_setopt(c.h, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c.h, CURLOPT_WRITEDATA, &buf);
    CURLcode code = curl_easy_perform(c.h);
    curl_slist_free_all(headers);
    if (code != CURLE_OK) return false;
    long status = 0; curl_easy_getinfo(c.h, CURLINFO_RESPONSE_CODE, &status);
    return status >= 200 && status < 300;
}

bool AgentQueueClient::enqueue(const Task& t, std::string* out_id) {
    CurlHandle c;
    std::string url = base_ + "/enqueue";
    json j = {
        {"agent", t.agent},
        {"model", t.model},
        {"priority", t.priority.empty() ? "low" : t.priority},
        {"payload", t.payload_json.empty() ? json::object() : json::parse(t.payload_json)}
    };
    std::string body_str = j.dump();
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    std::string buf;
    curl_easy_setopt(c.h, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c.h, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(c.h, CURLOPT_POSTFIELDS, body_str.c_str());
    curl_easy_setopt(c.h, CURLOPT_POSTFIELDSIZE, (long)body_str.size());
    curl_easy_setopt(c.h, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c.h, CURLOPT_WRITEDATA, &buf);
    CURLcode code = curl_easy_perform(c.h);
    curl_slist_free_all(headers);
    if (code != CURLE_OK) return false;
    long status = 0; curl_easy_getinfo(c.h, CURLINFO_RESPONSE_CODE, &status);
    if (status < 200 || status >= 300) return false;
    try {
        auto r = json::parse(buf);
        if (out_id && r.contains("id")) *out_id = r["id"].get<std::string>();
    } catch (...) {
        // ignore parse error
    }
    return true;
}
