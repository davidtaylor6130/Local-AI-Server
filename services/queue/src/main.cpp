#include <iostream>
#include <string>
#include <random>
#include <map>
#include <cstring>
#include <csignal>
#include <microhttpd.h>
#include <nlohmann/json.hpp>
#include "priority_queue.hpp"
#include <unordered_set>

using json = nlohmann::json;

static InMemoryPriorityQueue g_queue;
static std::unordered_set<std::string> g_paused_agents;

static std::string gen_id() {
    std::random_device rd;
    std::mt19937_64 rng(rd());
    std::uniform_int_distribution<uint64_t> dist;
    uint64_t a = dist(rng), b = dist(rng);
    char buf[33];
    snprintf(buf, sizeof(buf), "%016llx%016llx", (unsigned long long)a, (unsigned long long)b);
    return std::string(buf);
}

struct ConnInfo {
    std::string method;
    std::string url;
    std::string body;
};

static int send_response(struct MHD_Connection* conn, int status, const std::string& body, const char* ctype = "application/json") {
    struct MHD_Response* resp = MHD_create_response_from_buffer(body.size(), (void*)body.data(), MHD_RESPMEM_MUST_COPY);
    if (!resp) return MHD_NO;
    MHD_add_response_header(resp, MHD_HTTP_HEADER_CONTENT_TYPE, ctype);
    int ret = MHD_queue_response(conn, status, resp);
    MHD_destroy_response(resp);
    return ret;
}

static std::map<std::string,std::string> parse_query(struct MHD_Connection* conn) {
    std::map<std::string,std::string> out;
    MHD_get_connection_values(conn, MHD_GET_ARGUMENT_KIND,
        [](void* cls, enum MHD_ValueKind, const char* key, const char* val) -> int {
            auto* m = static_cast<std::map<std::string,std::string>*>(cls);
            (*m)[key ? key : ""] = val ? val : "";
            return MHD_YES;
        }, &out);
    return out;
}

static int handler(void* /*cls*/, struct MHD_Connection* connection, const char* url, const char* method,
                   const char* /*version*/, const char* upload_data, size_t* upload_data_size, void** con_cls) {
    ConnInfo* ci = static_cast<ConnInfo*>(*con_cls);
    if (!ci) {
        ci = new ConnInfo{method, url, {}};
        *con_cls = ci;
        return MHD_YES;
    }

    if (0 == strcmp(method, MHD_HTTP_METHOD_POST)) {
        if (*upload_data_size) {
            ci->body.append(upload_data, *upload_data_size);
            *upload_data_size = 0;
            return MHD_YES;
        }
    }

    std::string path(url);
    try {
        if (ci->method == "POST" && path == "/enqueue") {
            auto j = json::parse(ci->body);
            Job job;
            job.id = j.value("id", gen_id());
            job.agent = j.at("agent").get<std::string>();
            job.model = j.at("model").get<std::string>();
            job.priority = j.value("priority", std::string("low"));
            job.payload = j.value("payload", json::object()).dump();
            g_queue.enqueue(job);
            json out = {{"id", job.id}};
            return send_response(connection, MHD_HTTP_OK, out.dump());
        }
        if (ci->method == "GET" && path == "/dequeue") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            // If agent is paused, do not deliver work.
            if (g_paused_agents.count(it->second)) {
                return send_response(connection, MHD_HTTP_NO_CONTENT, "", "text/plain");
            }
            auto job = g_queue.dequeue_for_agent(it->second);
            if (!job) {
                return send_response(connection, MHD_HTTP_NO_CONTENT, "", "text/plain");
            }
            json out = {
                {"id", job->id},
                {"agent", job->agent},
                {"model", job->model},
                {"priority", job->priority},
                {"payload", json::parse(job->payload)}
            };
            return send_response(connection, MHD_HTTP_OK, out.dump());
        }
        if (ci->method == "GET" && path == "/stats") {
            auto s = g_queue.snapshot();
            json high = json::array();
            json low = json::array();
            json inflight = json::array();
            std::map<std::string, json> by_agent;
            auto push_job = [&](const Job& j, json& arr, const char* lane){
                json jj = {
                    {"id", j.id},
                    {"agent", j.agent},
                    {"model", j.model},
                    {"priority", j.priority},
                    {"payload", json::parse(j.payload)}
                };
                arr.push_back(jj);
                auto& m = by_agent[j.agent];
                if (m.is_null()) m = json({{"queued_high",0},{"queued_low",0},{"inflight",0}});
                if (std::string(lane) == "high") m["queued_high"] = m["queued_high"].get<int>() + 1;
                else if (std::string(lane) == "low") m["queued_low"] = m["queued_low"].get<int>() + 1;
                else if (std::string(lane) == "inflight") m["inflight"] = m["inflight"].get<int>() + 1;
            };
            for (const auto& j : s.high) push_job(j, high, "high");
            for (const auto& j : s.low) push_job(j, low, "low");
            for (const auto& j : s.inflight) push_job(j, inflight, "inflight");
            json metrics = {
                {"queued_high", high.size()},
                {"queued_low", low.size()},
                {"inflight", inflight.size()},
                {"by_agent", by_agent}
            };
            json out = {{"queues", {{"high", high}, {"low", low}}}, {"inflight", inflight}, {"metrics", metrics}};
            return send_response(connection, MHD_HTTP_OK, out.dump());
        }
        if (ci->method == "POST" && path == "/control/pause") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            g_paused_agents.insert(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"ok", true}}).dump());
        }
        if (ci->method == "POST" && path == "/control/resume") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            g_paused_agents.erase(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"ok", true}}).dump());
        }
        if (ci->method == "GET" && path == "/control/state") {
            json arr = json::array();
            for (const auto& a : g_paused_agents) arr.push_back(a);
            return send_response(connection, MHD_HTTP_OK, json({{"paused", arr}}).dump());
        }
        if (ci->method == "DELETE" && path == "/jobs") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            std::size_t removed = g_queue.cancel_queued_for_agent(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"removed", removed}}).dump());
        }
        if (ci->method == "POST" && path.rfind("/complete/", 0) == 0) {
            std::string id = path.substr(std::string("/complete/").size());
            if (id.empty()) {
                json err = {{"error","id required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            auto j = json::parse(ci->body);
            std::string status = j.value("status", std::string("ok"));
            bool ok = (status == "ok");
            g_queue.complete(id, ok, j.value("error", std::string("")));
            return send_response(connection, MHD_HTTP_OK, json({{"ok", true}}).dump());
        }
        if (ci->method == "GET" && path == "/peek") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            auto p = g_queue.peek_for_agent(it->second);
            if (!p) return send_response(connection, MHD_HTTP_NO_CONTENT, "", "text/plain");
            json out = {
                {"job", {
                    {"id", p->job.id},
                    {"agent", p->job.agent},
                    {"model", p->job.model},
                    {"priority", p->job.priority},
                    {"payload", json::parse(p->job.payload)}
                }},
                {"lane", p->lane},
                {"position", p->position}
            };
            return send_response(connection, MHD_HTTP_OK, out.dump());
        }
        if (ci->method == "POST" && path == "/control/skip_next") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            bool moved = g_queue.skip_next_for_agent(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"ok", moved}}).dump());
        }
        if (ci->method == "POST" && path == "/control/bring_forward") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            bool moved = g_queue.bring_forward_for_agent(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"ok", moved}}).dump());
        }
        if (ci->method == "POST" && path == "/control/stop") {
            auto q = parse_query(connection);
            auto it = q.find("agent");
            if (it == q.end() || it->second.empty()) {
                json err = {{"error","agent query parameter required"}};
                return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
            }
            g_paused_agents.insert(it->second);
            std::size_t removed = g_queue.cancel_queued_for_agent(it->second);
            return send_response(connection, MHD_HTTP_OK, json({{"ok", true}, {"paused", true}, {"removed", removed}}).dump());
        }
        return send_response(connection, MHD_HTTP_NOT_FOUND, json({{"error","not found"}}).dump());
    } catch (const std::exception& e) {
        json err = {{"error", e.what()}};
        return send_response(connection, MHD_HTTP_BAD_REQUEST, err.dump());
    }
}

int main(int, char**) {
    int port = 7000;
    if (const char* p = std::getenv("QUEUE_PORT")) {
        try { port = std::stoi(p); } catch (...) {}
    }
    std::cout << "[queue] Starting HTTP server on port " << port << "...\n";
    struct MHD_Daemon* d = MHD_start_daemon(MHD_USE_AUTO | MHD_USE_INTERNAL_POLLING_THREAD, port, nullptr, nullptr, &handler, nullptr, MHD_OPTION_END);
    if (!d) {
        std::cerr << "[queue] Failed to start HTTP server" << std::endl;
        return 1;
    }
    std::signal(SIGTERM, [](int){ /* allow graceful stop */ });
    pause();
    MHD_stop_daemon(d);
    return 0;
}
