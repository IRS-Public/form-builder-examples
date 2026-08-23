# syntax=docker/dockerfile:1
#
# tax-withholding-estimator — prod-like static image.
#
# The build context is this application's own directory. fact-graph, form-builder and taxpert are
# clones of three other repositories rather than parts of this one, so each is supplied as its own
# named build context. Cloned into the root of this repository — the same layout the Makefile's
# `../fact-graph` paths assume — the invocation is:
#
#   docker build \
#     --build-context fact_graph=../fact-graph \
#     --build-context form-builder=../form-builder \
#     --build-context taxpert=../taxpert/packages/ui \
#     -t tax-withholding-estimator .
#
#   stage 1 (libs)    : sbt publishLocal in fact-graph and form-builder -> Ivy artifacts + main.mjs
#   stage 2 (build)   : sbt 'run --auditMode …'                         -> static site in ./out
#   stage 3 (runtime) : nginx serves ./out
#
# There is no server at runtime: the generated site is fully static and the audit / taxpert UI is
# client-side JS. The mode flags are therefore baked in at build time — changing them means
# rebuilding this image.
#
# Each additional context keeps its own .dockerignore, not this one — a sibling library with a heavy
# target/ or node_modules/ and no .dockerignore of its own transfers it into the build.

# ---- shared sbt base --------------------------------------------------------------
FROM eclipse-temurin:21-jdk-jammy AS sbt-base
ARG SBT_VERSION=1.11.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libxml2-utils git make \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
      | tar -xz -C /opt
ENV PATH="/opt/sbt/bin:${PATH}"

# ---- stage 1: build and publish the sibling libraries -----------------------------
FROM sbt-base AS libs
WORKDIR /build
COPY --from=fact_graph . ./fact-graph/
COPY --from=form-builder . ./form-builder/
# The publishLocal output lands in /root/.ivy2/local — a real image layer, not a cache mount, so
# stage 2 can copy it. fastOptJS is what produces the browser bundle stage 2 vendors. The download
# caches are mounts because nothing later needs them.
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd fact-graph && sbt compile fastOptJS publishLocal
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd form-builder && sbt publishLocal

# ---- stage 2: generate the static site --------------------------------------------
FROM sbt-base AS build
WORKDIR /build/tax-withholding-estimator
COPY --from=libs /root/.ivy2 /root/.ivy2
COPY . ./

# `make copy-fg`, without the Makefile: drop the freshly built Scala.js bundle into vendor/.
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/twe/website-static/vendor/fact-graph/factgraph-3.1.0.js
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/twe/website-static/vendor/fact-graph/main.mjs.map

# `make copy-shared-ui`: vendor the workspace UI from the taxpert context. One COPY of the whole
# src/ tree rather than one per bundle, so a bundle added to taxpert reaches the browser without an
# edit here. Wipe first: COPY merges into the destination, so without this a file deleted in
# taxpert/src could survive as a stale vendored copy.
RUN rm -rf ./src/main/resources/twe/website-static/vendor/taxpert
COPY --from=taxpert src ./src/main/resources/twe/website-static/vendor/taxpert

RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt 'run --auditMode --allScreens'

# ---- stage 3: runtime -------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/tax-withholding-estimator/out /usr/share/nginx/html
EXPOSE 80
