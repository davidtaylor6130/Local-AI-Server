cmake_minimum_required(VERSION 3.16)
project(rag_cpp CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(nlohmann_json REQUIRED)

add_executable(rag_cli
  src/main.cpp
  src/http.cpp
  src/rag.cpp
  src/store.cpp
  src/chunk.cpp
  src/util.cpp
)

target_include_directories(rag_cli PRIVATE include)
target_link_libraries(rag_cli
  PRIVATE
    CURL::libcurl
    SQLite::SQLite3
    OpenSSL::SSL OpenSSL::Crypto
    nlohmann_json::nlohmann_json
)

