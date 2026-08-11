# syntax=docker/dockerfile:1
#
# tax-withholding-estimator — prod-like static image.
#
# The same four stages as credit-assistant/Dockerfile, with this app's directory, resource
# dir and run flags substituted; read that file for why each stage exists. The two are
# deliberately parallel rather than shared: a Formative app owns its own image, and the
# only thing that varies is the three names below and the flags on `sbt run`.
#
# Build context is the REPO ROOT (see docker-compose.yml): this build compiles the two
# sibling Scala libraries from source (neither is published to a remote) and vendors the
# workspace UI out of taxpert/src.
#
#   stage 1 (factgraph) : sbt compile fastOptJS publishLocal   -> Ivy artifact + main.mjs
#   stage 2 (formative) : sbt publishLocal                     -> Ivy artifact (theme + runtime inside it)
#   stage 3 (build)     : sbt 'run --auditMode --allScreens'   -> static site in ./out
#   stage 4 (runtime)   : nginx serves ./out
#
# The flags match this app's `make dev` minus --serve. TWE has no scenarios and no Author
# Mode (see its fact-explorer.app.json capabilities), so --scenarioMode and --authorMode are
# absent here where credit-assistant carries them.

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
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt compile fastOptJS publishLocal

# ---- stage 2: build + publish the formative scaffold -----------------------------
FROM sbt-base AS formative
WORKDIR /build/formative
COPY --from=factgraph /root/.ivy2 /root/.ivy2
COPY formative/ ./
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt publishLocal

# ---- stage 3: generate the static site -------------------------------------------
FROM sbt-base AS build
WORKDIR /build/tax-withholding-estimator
COPY --from=formative /root/.ivy2 /root/.ivy2
COPY tax-withholding-estimator/ ./
# Equivalent of `make copy-fg`.
COPY --from=factgraph \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/twe/website-static/vendor/fact-graph/factgraph-3.1.0.js
COPY --from=factgraph \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/twe/website-static/vendor/fact-graph/main.mjs.map
# Equivalent of `make copy-shared-ui`. Wipe first: COPY merges into the destination, so
# without this a file deleted in taxpert/src could survive as a stale vendored copy.
RUN rm -rf ./src/main/resources/twe/website-static/vendor/taxpert
COPY taxpert/src ./src/main/resources/twe/website-static/vendor/taxpert
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt 'run --auditMode --allScreens'

# ---- stage 4: runtime ------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY tax-withholding-estimator/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/tax-withholding-estimator/out /usr/share/nginx/html
EXPOSE 80
