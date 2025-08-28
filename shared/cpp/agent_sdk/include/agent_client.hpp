#pragma once
#include <string>
#include <optional>
#include <map>
#include <vector>

struct Task {
    std::string id;
    std::string agent;
    std::string model;
    std::string priority; // high|low
    std::string payload_json; // raw JSON string
};

class AgentQueueClient {
public:
    explicit AgentQueueClient(std::string base_url);
    std::optional<Task> dequeue(const std::string& agent);
    bool complete(const std::string& id, bool ok, const std::string& error = {});
    bool enqueue(const Task& t, std::string* out_id = nullptr);

private:
    std::string base_;
};

