#pragma once
#include <string>
#include <optional>

struct Job {
    std::string id;       // unique id
    std::string agent;    // target agent name (e.g., "rag")
    std::string model;    // model to use (passed to agent)
    std::string priority; // "high" or "low"
    std::string payload;  // raw JSON payload as string (agent-specific)
};

