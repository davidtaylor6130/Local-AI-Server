cmake_minimum_required(VERSION 3.16)
project(agent_changelog_summarizer CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../shared/cpp/agent_sdk ${CMAKE_CURRENT_BINARY_DIR}/agent_sdk)
find_package(nlohmann_json REQUIRED)

add_executable(changelog_summarizer
  src/main.cpp
)

target_include_directories(changelog_summarizer PRIVATE include)
target_link_libraries(changelog_summarizer PRIVATE agent_sdk nlohmann_json::nlohmann_json)

