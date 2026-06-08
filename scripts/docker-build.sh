#!/usr/bin/env sh
# Reliable multi-stage Docker build for Jenkins (shared Docker host).
#
# Fixes "invalid from flag value builder: No such image: sha256:…" by:
#   - pruning dangling builder cache when BuildKit/buildx is available
#   - retrying once with --no-cache if the first build fails
#
# Usage: scripts/docker-build.sh <image-tag>
#
# Optional env:
#   DOCKER_BUILDKIT=0          (default; Jenkins agents often lack buildx)
#   NODE_BUILD_HEAP_MB=2048    (Nest compile heap in Dockerfile builder stage)

set -eu

IMAGE_TAG="${1:?usage: docker-build.sh <image-tag>}"

export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
NODE_BUILD_HEAP_MB="${NODE_BUILD_HEAP_MB:-2048}"

echo "[docker-build] image=${IMAGE_TAG} DOCKER_BUILDKIT=${DOCKER_BUILDKIT} NODE_BUILD_HEAP_MB=${NODE_BUILD_HEAP_MB}"

if [ "${DOCKER_BUILDKIT}" = "1" ]; then
  docker builder prune -f --filter 'dangling=true' 2>/dev/null || true
fi

if docker build \
  --build-arg "NODE_BUILD_HEAP_MB=${NODE_BUILD_HEAP_MB}" \
  -t "${IMAGE_TAG}" \
  .; then
  echo "[docker-build] success: ${IMAGE_TAG}"
  exit 0
fi

echo "[docker-build] first build failed — retrying with --no-cache"
if [ "${DOCKER_BUILDKIT}" = "1" ]; then
  docker builder prune -af 2>/dev/null || true
fi

docker build --no-cache \
  --build-arg "NODE_BUILD_HEAP_MB=${NODE_BUILD_HEAP_MB}" \
  -t "${IMAGE_TAG}" \
  .

echo "[docker-build] success (no-cache retry): ${IMAGE_TAG}"