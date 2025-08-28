FROM ubuntu:22.04 as build
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential cmake libmicrohttpd-dev nlohmann-json3-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN cmake -S . -B build && cmake --build build -j

FROM ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libmicrohttpd12 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build/queue_service /usr/local/bin/queue_service
EXPOSE 7000
CMD ["/usr/local/bin/queue_service"]
