FROM ubuntu:22.04 as build
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential cmake curl ca-certificates git \
    libcurl4-openssl-dev libsqlite3-dev nlohmann-json3-dev libssl-dev && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN cmake -S . -B build && cmake --build build -j

FROM ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libcurl4 openssl libsqlite3-0 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build/rag_cli /usr/local/bin/rag_cli
VOLUME ["/data", "/knowledge"]
ENV RAG_DB_PATH=/data/rag.db
CMD ["/usr/local/bin/rag_cli", "ingest", "--dir", "/knowledge", "--db", "/data/rag.db"]

