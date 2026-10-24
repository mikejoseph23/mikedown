# packages/desktop/deploy/linux/Dockerfile
# Build image for the experimental x86_64 Linux AppImage (see build-linux.sh).
# Ubuntu 22.04 is the Tauri 2 baseline: an AppImage built here links against
# glibc 2.35 and webkit2gtk-4.1, so it runs on that or anything newer (Arch).
FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl wget file ca-certificates git rsync xz-utils pkg-config \
        libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
        libssl-dev libxdo-dev patchelf \
        xvfb xauth dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (same major as the Mac build machines; the repo has no Volta pin).
ARG NODE_VERSION=22.20.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1

# Rust stable (Cargo.toml asks for 1.90+).
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+w /usr/local/rustup /usr/local/cargo

WORKDIR /work
