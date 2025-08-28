cmake_minimum_required(VERSION 3.16)
project(agent_sdk CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)

add_library(agent_sdk
  src/agent_client.cpp
)

target_include_directories(agent_sdk PUBLIC include)
target_link_libraries(agent_sdk
  PRIVATE CURL::libcurl nlohmann_json::nlohmann_json
)

