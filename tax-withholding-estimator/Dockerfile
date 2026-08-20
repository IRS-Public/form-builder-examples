# syntax=docker/dockerfile:1
#
# tax-withholding-estimator — prod-like static image.
#
# Build context is the REPO ROOT (see docker-compose.yml) because this build vendors the workspace
# UI from packages/ui, which lives outside this directory.
#
# The two Scala libraries are no longer built here: gov.irs::formative resolves from GitHub
# Packages, and gov.irs:factgraph under it. GitHub Packages requires auth even to read, so the
# build needs a token — passed as a build secret, never as an ARG, so it stays out of image layers:
#
#   docker build \
#     --secret id=github_token,env=GITHUB_TOKEN \
#     --build-arg GITHUB_OWNER=<org> --build-arg GITHUB_ACTOR=<login> \
#     -f examples/tax-withholding-estimator/Dockerfile .
#
#   stage 1 (build)   : sbt 'run --auditMode …'  -> static site in ./out
#   stage 2 (runtime) : nginx serves ./out
#
# There is no server at runtime: the generated site is fully static and the audit /
# taxpert UI is client-side JS. The mode flags are therefore baked in at build time —
# changing them means rebuilding this image.

FROM eclipse-temurin:21-jdk-jammy AS sbt-base
ARG SBT_VERSION=1.11.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libxml2-utils git python3 python3-pip \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir pre-commit \
 && curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
      | tar -xz -C /opt
ENV PATH="/opt/sbt/bin:${PATH}"

# ---- stage 1: generate the static site -------------------------------------------
FROM sbt-base AS build
# gov.irs::formative resolves from GitHub Packages, which requires auth even to read.
# Pass the token as a build secret so it never lands in an image layer:
#   docker build --secret id=github_token,env=GITHUB_TOKEN --build-arg GITHUB_OWNER=... .
ARG GITHUB_OWNER
ARG GITHUB_ACTOR
ENV GITHUB_OWNER=${GITHUB_OWNER} GITHUB_ACTOR=${GITHUB_ACTOR}
WORKDIR /build/tax-withholding-estimator
COPY examples/tax-withholding-estimator/ ./
# No `make copy-fg` step: vendor/fact-graph/factgraph-3.1.0.js is committed. fact-graph is a
# separate open-source repo now, so refreshing the bundle is `make copy-fg` against a checkout of
# it rather than a build stage here.
# Equivalent of `make copy-shared-ui`. Wipe first: COPY merges into the destination, so
# without this a file deleted in taxpert/src could survive as a stale vendored copy.
RUN rm -rf ./src/main/resources/twe/website-static/vendor/taxpert
COPY packages/ui/src ./src/main/resources/twe/website-static/vendor/taxpert
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    --mount=type=secret,id=github_token \
    GITHUB_TOKEN="$(cat /run/secrets/github_token)" \
    sbt 'run --auditMode --allScreens'

# ---- stage 2: runtime ------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY examples/tax-withholding-estimator/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/tax-withholding-estimator/out /usr/share/nginx/html
EXPOSE 80
