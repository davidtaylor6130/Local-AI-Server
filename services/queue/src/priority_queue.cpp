#include "priority_queue.hpp"
#include <utility>
#include <algorithm>

Job InMemoryPriorityQueue::enqueue(Job job) {
    std::lock_guard<std::mutex> lock(mtx_);
    if (job.priority == "high") {
        high_.push_back(job);
    } else {
        low_.push_back(job);
    }
    cv_.notify_one();
    return job;
}

std::optional<Job> InMemoryPriorityQueue::dequeue_for_agent(const std::string& agent) {
    std::unique_lock<std::mutex> lock(mtx_);
    // Non-blocking pop: prefer high priority when available.
    auto pop_from = [&](std::deque<Job>& q) -> std::optional<Job> {
        for (auto it = q.begin(); it != q.end(); ++it) {
            if (it->agent == agent) {
                Job j = *it;
                q.erase(it);
                inflight_.emplace(j.id, j);
                return j;
            }
        }
        return std::nullopt;
    };

    if (auto j = pop_from(high_)) return j;
    if (auto j = pop_from(low_)) return j;
    return std::nullopt;
}

void InMemoryPriorityQueue::complete(const std::string& id, bool ok, const std::string& /*result_or_error*/) {
    std::lock_guard<std::mutex> lock(mtx_);
    inflight_.erase(id);
    (void)ok; // future: metrics, dead-letter, etc.
}

QueueSnapshot InMemoryPriorityQueue::snapshot() {
    std::lock_guard<std::mutex> lock(mtx_);
    QueueSnapshot s;
    s.high.reserve(high_.size());
    s.low.reserve(low_.size());
    for (const auto& j : high_) s.high.push_back(j);
    for (const auto& j : low_) s.low.push_back(j);
    s.inflight.reserve(inflight_.size());
    for (const auto& kv : inflight_) s.inflight.push_back(kv.second);
    return s;
}

std::size_t InMemoryPriorityQueue::cancel_queued_for_agent(const std::string& agent) {
    std::lock_guard<std::mutex> lock(mtx_);
    auto remove_from = [&](std::deque<Job>& q) -> std::size_t {
        std::size_t before = q.size();
        q.erase(std::remove_if(q.begin(), q.end(), [&](const Job& j){ return j.agent == agent; }), q.end());
        return before - q.size();
    };
    std::size_t removed = 0;
    removed += remove_from(high_);
    removed += remove_from(low_);
    return removed;
}

std::optional<PeekInfo> InMemoryPriorityQueue::peek_for_agent(const std::string& agent) {
    std::lock_guard<std::mutex> lock(mtx_);
    for (std::size_t i = 0; i < high_.size(); ++i) {
        if (high_[i].agent == agent) {
            return PeekInfo{high_[i], std::string("high"), i};
        }
    }
    for (std::size_t i = 0; i < low_.size(); ++i) {
        if (low_[i].agent == agent) {
            return PeekInfo{low_[i], std::string("low"), i};
        }
    }
    return std::nullopt;
}

bool InMemoryPriorityQueue::skip_next_for_agent(const std::string& agent) {
    std::lock_guard<std::mutex> lock(mtx_);
    for (auto it = high_.begin(); it != high_.end(); ++it) {
        if (it->agent == agent) {
            Job j = *it;
            high_.erase(it);
            high_.push_back(j);
            return true;
        }
    }
    for (auto it = low_.begin(); it != low_.end(); ++it) {
        if (it->agent == agent) {
            Job j = *it;
            low_.erase(it);
            low_.push_back(j);
            return true;
        }
    }
    return false;
}

bool InMemoryPriorityQueue::bring_forward_for_agent(const std::string& agent) {
    std::lock_guard<std::mutex> lock(mtx_);
    for (auto it = high_.begin(); it != high_.end(); ++it) {
        if (it->agent == agent) {
            Job j = *it;
            high_.erase(it);
            high_.push_front(j);
            return true;
        }
    }
    for (auto it = low_.begin(); it != low_.end(); ++it) {
        if (it->agent == agent) {
            Job j = *it;
            low_.erase(it);
            high_.push_front(j); // promote to front of high
            return true;
        }
    }
    return false;
}
