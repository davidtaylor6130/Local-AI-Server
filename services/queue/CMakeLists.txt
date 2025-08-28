cmake_minimum_required(VERSION 3.16)
project(queue_service CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(queue_lib
  src/priority_queue.cpp
)
target_include_directories(queue_lib PUBLIC include)

add_executable(queue_service
  src/main.cpp
)
find_package(nlohmann_json REQUIRED)
find_library(MICROHTTPD_LIBRARY microhttpd)
if(NOT MICROHTTPD_LIBRARY)
  message(FATAL_ERROR "libmicrohttpd not found; install libmicrohttpd-dev")
endif()
target_link_libraries(queue_service PRIVATE queue_lib ${MICROHTTPD_LIBRARY} nlohmann_json::nlohmann_json pthread)
