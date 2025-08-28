cmake_minimum_required(VERSION 3.16)
project(agent_seo_onpage CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../shared/cpp/agent_sdk ${CMAKE_CURRENT_BINARY_DIR}/agent_sdk)
find_package(nlohmann_json REQUIRED)

add_executable(seo_onpage
  src/main.cpp
)

target_include_directories(seo_onpage PRIVATE include)
target_link_libraries(seo_onpage PRIVATE agent_sdk nlohmann_json::nlohmann_json)

