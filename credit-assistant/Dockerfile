# syntax=docker/dockerfile:1
#
# credit-assistant — prod-like static image.
#
# Build context is the REPO ROOT (see docker-compose.yml) because this build also
# compiles the sibling ../fact-graph library, which credit-assistant depends on at
# build time (gov.irs:factgraph:3.1.0-SNAPSHOT, resolved from the local Ivy cache).
#
#   stage 1 (factgraph) : sbt compile fastOptJS publishLocal   -> Ivy artifact + main.mjs
#   stage 2 (build)     : sbt 'run --auditMode ...'            -> static site in ./out
#   stage 3 (runtime)   : nginx serves ./out
#
# There is no server at runtime: the generated site is fully static and the audit /
# taxpert UI is client-side JS. The mode flags are therefore baked in at stage 2 —
# changing them means rebuilding this image.

# ---- shared sbt base -------------------------------------------------------------
FROM eclipse-temurin:21-jdk-jammy AS sbt-base
ARG SBT_VERSION=1.11.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libxml2-utils git python3 python3-pip \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir pre-commit \
 && curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
      | tar -xz -C /opt
ENV PATH="/opt/sbt/bin:${PATH}"

# ---- stage 1: build + publish the fact-graph library -----------------------------
FROM sbt-base AS factgraph
WORKDIR /build/fact-graph
COPY fact-graph/ ./
# Coursier/sbt download caches speed up repeat builds. The publishLocal output lands
# in /root/.ivy2/local (a real image layer, NOT a cache mount) so stage 2 can copy it.
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt compile fastOptJS publishLocal

# ---- stage 2: generate the static credit-assistant site --------------------------
FROM sbt-base AS build
WORKDIR /build/credit-assistant
# Carry over the locally published fact-graph JVM artifact.
COPY --from=factgraph /root/.ivy2 /root/.ivy2
COPY credit-assistant/ ./
# Equivalent of `make copy-fg`: drop the freshly built Scala.js bundle into vendor/.
COPY --from=factgraph \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/credit-assistant/website-static/vendor/fact-graph/factgraph-3.1.0.js
COPY --from=factgraph \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/credit-assistant/website-static/vendor/fact-graph/main.mjs.map
# Equivalent of `make copy-shared-ui`: vendor the shared UI components from the
# sibling ../taxpert-ui repo (see docker-compose.yml — same reason this build's
# context is the repo root, not just credit-assistant/). Mirrors the bundle-dir
# layout (global-nav/, audit-panel/, shared/, each with js/styles/images/fonts/).
#
# Wipe first, exactly as the Makefile recipe does: COPY merges into the destination
# rather than replacing it, so without this a file deleted or renamed in taxpert-ui/src
# could survive in the image as a stale vendored copy. (The mirror is untracked and
# .dockerignore'd, so this only bites when a developer's working tree carries one.)
RUN rm -rf ./src/main/resources/credit-assistant/website-static/vendor/taxpert-ui
COPY taxpert-ui/src/global-nav ./src/main/resources/credit-assistant/website-static/vendor/taxpert-ui/global-nav
COPY taxpert-ui/src/audit-panel ./src/main/resources/credit-assistant/website-static/vendor/taxpert-ui/audit-panel
COPY taxpert-ui/src/shared ./src/main/resources/credit-assistant/website-static/vendor/taxpert-ui/shared
# Generate out/app/eitc/** with the audit UI baked in (no --serve -> exits after writing).
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt 'run --auditMode --allScreens --scenarioMode'

# ---- stage 3: runtime ------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY credit-assistant/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/credit-assistant/out /usr/share/nginx/html
EXPOSE 80
