#include <iostream>
#include <thread>
#include <chrono>
#include <cstdlib>
#include <nlohmann/json.hpp>
#include "../../../shared/cpp/agent_sdk/include/agent_client.hpp"

using json = nlohmann::json;

static std::string getenv_or(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return v ? std::string(v) : def;
}

static bool process_task(const Task& t) {
    try {
        auto j = json::parse(t.payload_json);
        std::cout << "[changelog-summarizer] Range: " << j.value("range", std::string("(missing)")) << std::endl;
    } catch (...) {
        std::cout << "[changelog-summarizer] Processing job " << t.id << std::endl;
    }
    // TODO: summarize git commits and write CHANGELOG patch
    return true;
}

int main(int argc, char** argv) {
    const std::string agent = "changelog-summarizer";
    const std::string queue_url = getenv_or("QUEUE_URL", "http://localhost:7000");
    int poll_ms = 1000; bool once = false;
    for (int i = 1; i < argc; ++i) { std::string a = argv[i]; if (a=="--once") once=true; else if (a=="--poll-ms" && i+1<argc) poll_ms=std::stoi(argv[++i]); }
    AgentQueueClient client(queue_url);
    std::cout << "[changelog-summarizer] Starting. QUEUE_URL=" << queue_url << std::endl;
    do {
        if (auto t = client.dequeue(agent)) {
            bool ok = false; try { ok = process_task(*t);} catch(const std::exception& e){ client.complete(t->id,false,e.what()); continue; }
            client.complete(t->id, ok, ok?"":"failed");
        } else { std::this_thread::sleep_for(std::chrono::milliseconds(poll_ms)); }
    } while (!once);
    return 0;
}

