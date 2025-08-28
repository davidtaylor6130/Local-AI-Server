#pragma once
#include "job.hpp"
#include <deque>
#include <mutex>
#include <condition_variable>
#include <optional>
#include <unordered_map>
#include <vector>

struct QueueSnapshot {
    std::vector<Job> high;
    std::vector<Job> low;
    std::vector<Job> inflight;
};

struct PeekInfo {
    Job job;
    std::string lane; // "high" | "low"
    std::size_t position; // index within lane for that agent's next job
};

class InMemoryPriorityQueue {
public:
    Job enqueue(Job job);
    std::optional<Job> dequeue_for_agent(const std::string& agent);
    void complete(const std::string& id, bool ok, const std::string& result_or_error = {});
    QueueSnapshot snapshot();
    std::size_t cancel_queued_for_agent(const std::string& agent);
    std::optional<PeekInfo> peek_for_agent(const std::string& agent);
    bool skip_next_for_agent(const std::string& agent);
    bool bring_forward_for_agent(const std::string& agent);

private:
    std::mutex mtx_;
    std::condition_variable cv_;
    std::deque<Job> high_;
    std::deque<Job> low_;
    std::unordered_map<std::string, Job> inflight_;
};
