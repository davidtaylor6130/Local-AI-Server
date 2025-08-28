cmake_minimum_required(VERSION 3.16)
project(agent_daily_reflection CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../shared/cpp/agent_sdk ${CMAKE_CURRENT_BINARY_DIR}/agent_sdk)
find_package(nlohmann_json REQUIRED)

add_executable(daily_reflection
  src/main.cpp
)

target_include_directories(daily_reflection PRIVATE include)
target_link_libraries(daily_reflection PRIVATE agent_sdk nlohmann_json::nlohmann_json)

