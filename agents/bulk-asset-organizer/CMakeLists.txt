cmake_minimum_required(VERSION 3.16)
project(agent_bulk_asset_organizer CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../shared/cpp/agent_sdk ${CMAKE_CURRENT_BINARY_DIR}/agent_sdk)
find_package(nlohmann_json REQUIRED)

add_executable(bulk_asset_organizer
  src/main.cpp
)

target_include_directories(bulk_asset_organizer PRIVATE include)
target_link_libraries(bulk_asset_organizer PRIVATE agent_sdk nlohmann_json::nlohmann_json)

