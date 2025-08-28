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
    // Minimal stub: pretend to analyze payload
    try {
        auto j = json::parse(t.payload_json);
        std::cout << "[seo-onpage] Processing job " << t.id << " with keys: ";
        bool first = true;
        for (auto it = j.begin(); it != j.end(); ++it) {
            if (!first) std::cout << ", ";
            std::cout << it.key();
            first = false;
        }
        std::cout << std::endl;
    } catch (...) {
        std::cout << "[seo-onpage] Processing job " << t.id << " (payload not JSON)" << std::endl;
    }
    // TODO: add SEO checks and suggestions
    return true;
}

int main(int argc, char** argv) {
    const std::string agent = "seo-onpage";
    const std::string queue_url = getenv_or("QUEUE_URL", "http://localhost:7000");
    int poll_ms = 1000;
    bool once = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--once") once = true;
        else if (a == "--poll-ms" && i + 1 < argc) poll_ms = std::stoi(argv[++i]);
    }

    AgentQueueClient client(queue_url);
    std::cout << "[seo-onpage] Starting. QUEUE_URL=" << queue_url << " poll_ms=" << poll_ms << (once?" once":" loop") << std::endl;
    do {
        if (auto t = client.dequeue(agent)) {
            bool ok = false;
            try {
                ok = process_task(*t);
            } catch (const std::exception& e) {
                std::cerr << "[seo-onpage] Error: " << e.what() << std::endl;
                client.complete(t->id, false, e.what());
                continue;
            }
            client.complete(t->id, ok, ok?"":"failed");
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(poll_ms));
        }
    } while (!once);
    return 0;
}

