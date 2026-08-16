#!/usr/bin/env bash
#
# Build every service image and push it to Docker Hub.
#
#   ./scripts/push-images.sh                 # all services, tag 0.2.0, linux/amd64
#   TAG=0.3.0 ./scripts/push-images.sh       # different tag
#   ./scripts/push-images.sh auth-service    # just one (or a few)
#
# Requires `docker login` first. Images land at docker.io/$NAMESPACE/<service>:<tag>.
#
# Docker Hub repositories are FLAT — there is no `auth/auth-service` nesting like
# Artifact Registry has, so the image name is simply the app directory name.
set -uo pipefail

NAMESPACE="${DOCKERHUB_NAMESPACE:-rohitf116}"
TAG="${TAG:-0.2.0}"
# The server is amd64. A Mac builds arm64 natively, so this cross-builds under
# emulation — the first run is slow, especially auth-service (compiles bcrypt).
PLATFORM="${PLATFORM:-linux/amd64}"
BUILDER="${BUILDER:-ecom-builder}"

ALL_SERVICES=(
  api-gateway
  auth-service
  product-service
  cart-service
  orders-service
  payment-service
  user-service
)

if [ "$#" -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=("${ALL_SERVICES[@]}")
fi

# Build context must be the repo root — every service imports @app/common from libs/.
cd "$(dirname "$0")/.."

# The default `docker` driver can't reliably cross-build and push in one step;
# a docker-container builder can.
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "==> creating buildx builder '$BUILDER'"
  docker buildx create --name "$BUILDER" --driver docker-container --bootstrap || exit 1
fi

echo "==> pushing to docker.io/$NAMESPACE  tag=$TAG  platform=$PLATFORM"
echo

failed=()
for svc in "${SERVICES[@]}"; do
  echo "======================================================================"
  echo "==> $svc"
  echo "======================================================================"
  if docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORM" \
    -f "apps/$svc/Dockerfile" \
    -t "docker.io/$NAMESPACE/$svc:$TAG" \
    -t "docker.io/$NAMESPACE/$svc:latest" \
    --push \
    .; then
    echo "==> OK  $svc"
  else
    echo "==> FAILED  $svc"
    failed+=("$svc")
  fi
  echo
done

echo "======================================================================"
if [ ${#failed[@]} -eq 0 ]; then
  echo "All ${#SERVICES[@]} images pushed to docker.io/$NAMESPACE at tag $TAG"
else
  echo "FAILED (${#failed[@]}): ${failed[*]}"
  echo "Re-run just those: ./scripts/push-images.sh ${failed[*]}"
  exit 1
fi
