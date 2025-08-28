#pragma once
#include <string>
#include <map>

struct HttpResponse {
    long status{0};
    std::string body;
};

HttpResponse http_post_json(const std::string& url, const std::string& json_body, long timeout_ms = 30000);

