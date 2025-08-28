cmake_minimum_required(VERSION 3.16)
project(agent_docs_site_builder CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../shared/cpp/agent_sdk ${CMAKE_CURRENT_BINARY_DIR}/agent_sdk)
find_package(nlohmann_json REQUIRED)

add_executable(docs_site_builder
  src/main.cpp
)

target_include_directories(docs_site_builder PRIVATE include)
target_link_libraries(docs_site_builder PRIVATE agent_sdk nlohmann_json::nlohmann_json)

