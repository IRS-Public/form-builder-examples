# syntax=docker/dockerfile:1
#
# Direct File — prod-like static image.
#
# The build context is this repository itself. fact-graph, form-builder and taxpert are not
# guaranteed to sit beside it, so each is supplied as its own named build context instead of a
# subdirectory of a shared parent — docker-compose.yml passes the paths this app was generated with
# (fact_graph_path / form_builder_path / taxpert_path in cookiecutter.json) via `additional_contexts`.
# Building with plain `docker build` needs the same three paths spelled out by hand:
#
#   docker build \
#     --build-context fact_graph=../../fact-graph \
#     --build-context form-builder=../../form-builder \
#     --build-context taxpert=../../taxpert/packages/ui \
#     -t direct-file .
#
#   stage 1 (libs)    : sbt publishLocal in fact-graph and form-builder -> Ivy artifacts + main.mjs
#   stage 2 (build)   : sbt run                                      -> static site in ./out
#   stage 3 (runtime) : nginx serves ./out
#
# There is no server at runtime: the generated site is fully static and the Taxpert workspace is
# client-side JavaScript. Which developer surfaces exist is therefore decided at stage 2 by the
# flags on `sbt run` — changing them means rebuilding this image. This one passes no *developer*
# surface, so the image is the product and nothing else. --singleQuestionPerScreen is not one of
# those: it is how this application presents its flow in every build, product included. The
# Makefile's FLAGS comment says why.
#
# Each additional context keeps its own .dockerignore rather than this repo's. A library context with a
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
WORKDIR /build/direct-file
COPY --from=libs /root/.ivy2 /root/.ivy2
COPY . ./

# `make copy-fg`, without the Makefile: drop the freshly built Scala.js bundle into vendor/.
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/direct-file/website-static/vendor/fact-graph/factgraph-3.1.0.js
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/direct-file/website-static/vendor/fact-graph/main.mjs.map

# `make copy-shared-ui`. One COPY of the whole src/ tree rather than one per bundle: a hand-kept
# list of bundles produced images whose UI was silently incomplete when a bundle was added and the
# list was not. Wipe first — COPY merges into the destination rather than replacing it, so without
# this a file renamed in the package could survive as a stale vendored copy.
RUN rm -rf ./src/main/resources/direct-file/website-static/vendor/taxpert
COPY --from=taxpert src ./src/main/resources/direct-file/website-static/vendor/taxpert

# `make copy-uswds`. npm is only needed for this and for the linters, so it is installed here
# rather than in the shared base.
RUN --mount=type=cache,target=/root/.npm \
    apt-get update && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm --prefix ./src/main/resources/direct-file install --omit=dev \
 && make copy-uswds

RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt 'run --singleQuestionPerScreen'

# ---- stage 3: runtime --------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/direct-file/out /usr/share/nginx/html

# Where to open the app, printed once at container start — the Docker counterpart of the banner
# `sbt run --serve` prints for `make dev`, which this image has no equivalent of: nothing here runs
# with --serve, so without this line `docker compose up` finishes with an access log and no address.
#
# nginx's own entrypoint runs every *executable* /docker-entrypoint.d/*.sh in name order before
# exec'ing nginx, so the 99- prefix puts this last, immediately above the first request. It must be
# executable or the entrypoint prints "not executable, ignoring" and moves on — hence --chmod.
#
# APP_PORT is the HOST's published port, which the container has no way to discover: it sees only
# its own :80. docker-compose.yml maps 3008:80 and passes the same number back in, so change
# the two together. The base path is baked into the generated site, so it is written in rather than
# configured.
# APP_DEV_SURFACES is empty here and set by the dev overlay. The prod-like image builds with no
# flags at all, so it has no Author Mode page and no workspace to speak of — printing those
# addresses unconditionally would advertise two URLs that 404 in exactly the image meant to be the
# product. One variable rather than one per surface: they all arrive together, from `make up`.
ENV APP_PORT=3008
ENV APP_DEV_SURFACES=""
COPY --chmod=0755 <<'EOF' /docker-entrypoint.d/99-print-url.sh
#!/bin/sh
# The dev overlay points nginx at a volume the watcher fills in later, so this can legitimately start
# with an empty web root. Say so rather than printing an address that 404s for the next few minutes.
printf '\n\033[32m\033[1m✓\033[0m \033[1mDirect File\033[0m \033[36mready\033[0m\n'
printf '  \033[1mFlow:\033[0m            \033[36mhttp://localhost:%s/app/direct-file/\033[0m\n' "$APP_PORT"
if [ -n "$APP_DEV_SURFACES" ]; then
  printf '  \033[1mAuthor Mode:\033[0m     \033[36mhttp://localhost:%s/app/direct-file/author/\033[0m\n' "$APP_PORT"
  printf '  \033[1mBrowse All:\033[0m      \033[36mhttp://localhost:%s/app/direct-file/all-screens/\033[0m\n' "$APP_PORT"
  printf '  \033[1mFact Explorer:\033[0m   \033[36mhttp://localhost:5180/fact-explorer/direct-file\033[0m\n'
fi
if [ ! -f /usr/share/nginx/html/app/direct-file/index.html ]; then
  printf '  \033[33m⚠ no site in the web root yet — the watcher is still generating it; refresh once it lands\033[0m\n'
fi
printf '\n'
EOF

EXPOSE 80
