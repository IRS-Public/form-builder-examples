# syntax=docker/dockerfile:1
#
# Benefits Enrollment — prod-like static image.
#
# The build context is this repository itself. fact-graph, form-builder and taxpert are not
# guaranteed to sit beside it, so each is supplied as its own named build context instead of a
# subdirectory of a shared parent — docker-compose.yml passes the paths this app was generated with
# (fact_graph_path / form_builder_path / taxpert_path in cookiecutter.json) via `additional_contexts`.
# Building with plain `docker build` needs the same three paths spelled out by hand:
#
#   docker build \
#     --build-context fact_graph=../fact-graph \
#     --build-context form-builder=../form-builder \
#     --build-context taxpert=../taxpert/packages/ui \
#     -t benefits-enrollment .
#
#   stage 1 (libs)    : sbt publishLocal in fact-graph and form-builder -> Ivy artifacts + main.mjs
#   stage 2 (build)   : sbt run                                      -> static site in ./out
#   stage 3 (runtime) : nginx serves ./out
#
# There is no server at runtime: the generated site is fully static and the Taxpert workspace is
# client-side JavaScript. Which developer surfaces exist is therefore decided at stage 2 by the
# flags on `sbt run` — changing them means rebuilding this image. This one passes none, so the
# image is the product and nothing else.
#
# Each additional context keeps its own .dockerignore, not this repo's — a sibling library with a
# heavy target/ or node_modules/ and no .dockerignore of its own transfers it into the build.

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
# stage 2 can copy it. The download caches are mounts because nothing later needs them.
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd fact-graph && sbt compile fastOptJS publishLocal
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd form-builder && sbt publishLocal

# ---- stage 2: generate the static site --------------------------------------------
FROM sbt-base AS build
WORKDIR /build/benefits-enrollment
COPY --from=libs /root/.ivy2 /root/.ivy2
COPY . ./

# `make copy-fg`, without the Makefile: drop the freshly built Scala.js bundle into vendor/.
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/benefits-enrollment/website-static/vendor/fact-graph/factgraph-3.1.0.js
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/benefits-enrollment/website-static/vendor/fact-graph/main.mjs.map

# `make copy-shared-ui`. One COPY of the whole src/ tree rather than one per bundle: a hand-kept
# list of bundles produced images whose UI was silently incomplete when a bundle was added and the
# list was not. Wipe first — COPY merges into the destination rather than replacing it, so without
# this a file renamed in the package could survive as a stale vendored copy.
RUN rm -rf ./src/main/resources/benefits-enrollment/website-static/vendor/taxpert
COPY --from=taxpert src ./src/main/resources/benefits-enrollment/website-static/vendor/taxpert

# `make copy-uswds`. npm is only needed for this and for the linters, so it is installed here
# rather than in the shared base.
RUN --mount=type=cache,target=/root/.npm \
    apt-get update && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm --prefix ./src/main/resources/benefits-enrollment install --omit=dev \
 && make copy-uswds

RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt run

# ---- stage 3: runtime --------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/benefits-enrollment/out /usr/share/nginx/html
EXPOSE 80
