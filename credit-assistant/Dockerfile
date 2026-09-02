# syntax=docker/dockerfile:1
#
# Credit Assistant (EITC): a prod-like static image.
#
# Every application in this repository builds from this same Dockerfile. Everything that varies sits
# in the ARG block below, so `diff` between any two applications' Dockerfiles shows those four lines
# and nothing else. Change the shape here and change it in all three.
#
#   APP_DIR        this application's directory name, and its WORKDIR under /build
#   RESOURCES_DIR  the directory under src/main/resources this application owns
#   SITE_FLAGS     generator flags baked into the image. `--build-arg SITE_FLAGS=` for a bare site
#   VENDOR_USWDS   1 when the application installs USWDS from npm rather than committing it
#
ARG APP_DIR=credit-assistant
ARG RESOURCES_DIR=credit-assistant
ARG SITE_FLAGS="--auditMode --allScreens --scenarioMode"
ARG VENDOR_USWDS=0
ARG SBT_VERSION=1.11.4

# The build context is this application's own directory. fact-graph, form-builder and taxpert are
# clones of three other repositories rather than parts of this one, so each arrives as its own named
# build context. docker-compose.yml passes all three; a plain `docker build` needs them by hand:
#
#   docker build \
#     --build-context fact_graph=../../fact-graph \
#     --build-context form-builder=../../form-builder \
#     --build-context taxpert=../../taxpert/packages/ui \
#     -t credit-assistant .
#
#   stage 1 (libs)    : sbt publishLocal in fact-graph and form-builder -> Ivy artifacts + main.mjs
#   stage 2 (build)   : sbt run $SITE_FLAGS                             -> static site in ./out
#   stage 3 (runtime) : nginx serves ./out
#
# There is no server at runtime. The generated site is fully static and the workspace UI is
# client-side JS, so which developer surfaces exist was decided by SITE_FLAGS at build time and
# changing them means rebuilding the image.
#
# Each additional context keeps its own .dockerignore rather than this one. A sibling library with a
# heavy target/ or node_modules/ and no .dockerignore of its own transfers all of it into the build.

# ---- shared sbt base --------------------------------------------------------------
FROM eclipse-temurin:21-jdk-jammy AS sbt-base
ARG SBT_VERSION
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
# The publishLocal output lands in /root/.ivy2/local, a real image layer rather than a cache mount,
# so stage 2 can copy it. fastOptJS is what produces the browser bundle stage 2 vendors. The
# download caches are mounts because nothing later needs them.
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd fact-graph && sbt compile fastOptJS publishLocal
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    cd form-builder && sbt publishLocal

# ---- stage 1b: build the taxpert workspace bundle ----------------------------------
#
# TX-3. The workspace ships as one JS bundle plus flattened stylesheets, built from the very src/
# tree stage 2 vendors beside it — 81 requests on a page become 5. `make copy-shared-ui` runs this
# build natively; the image builds its own rather than accepting one from the context, so an image
# can never ship a bundle and a source tree that disagree (taxpert's .dockerignore excludes dist/
# for exactly that reason).
#
# Its own small Node stage: the sbt base has no npm, and stage 2 only installs one late, after the
# vendored copy it would be needed for.
FROM node:22-bookworm-slim AS taxpert-ui
WORKDIR /ui
COPY --from=taxpert . .
# `npm install` rather than `npm ci`: this package is a workspace member, so its own lockfile is
# not the one npm maintains, and `ci` would refuse it.
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund && npm run build

# ---- stage 2: generate the static site --------------------------------------------
FROM sbt-base AS build
ARG APP_DIR
ARG RESOURCES_DIR
ARG SITE_FLAGS
ARG VENDOR_USWDS
WORKDIR /build/${APP_DIR}
COPY --from=libs /root/.ivy2 /root/.ivy2
COPY . ./

# `make copy-fg`, without the Makefile: the freshly built Scala.js bundle over the committed one.
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs \
     ./src/main/resources/${RESOURCES_DIR}/website-static/vendor/fact-graph/factgraph-3.1.0.js
# DF-8: the .map is deliberately NOT copied. It is 4.6 MB of image size and 4.6 MB of download for
# anyone who opens DevTools to investigate a slow load — the one person it is meant to help. A
# native `make copy-fg` still places it beside the bundle, so a host build keeps source-mapped
# stack traces; the image does not.

# `make copy-shared-ui`: vendor the workspace UI from the taxpert context, mirroring its bundle-dir
# layout (global-nav/, audit-panel/, shared/, tool-panels/, each with js/styles/templates).
#
# The theme is NOT here. It ships inside the form-builder jar, and the `sbt run` below extracts it
# into out/…/resources/vendor/form-builder/. See FormBuilderAssets.scala.
#
# One COPY of the whole src/ tree rather than one per bundle: the per-bundle list had to be kept in
# step with taxpert by hand, and a bundle missing from it produced an image whose UI was silently
# incomplete. Wipe first, exactly as the Makefile recipe does. COPY merges into the destination
# rather than replacing it, so without this a file deleted or renamed in taxpert/src could survive
# in the image as a stale vendored copy.
RUN rm -rf ./src/main/resources/${RESOURCES_DIR}/website-static/vendor/taxpert
COPY --from=taxpert src ./src/main/resources/${RESOURCES_DIR}/website-static/vendor/taxpert
COPY --from=taxpert-ui /ui/dist ./src/main/resources/${RESOURCES_DIR}/website-static/vendor/taxpert/dist

# `make copy-uswds`, for the applications that install the design system from npm rather than
# committing it. npm is needed for nothing else in this image, so it is installed here rather than
# in the shared base, and only when VENDOR_USWDS says so.
RUN --mount=type=cache,target=/root/.npm \
    if [ "${VENDOR_USWDS}" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends nodejs npm \
   && rm -rf /var/lib/apt/lists/* \
   && npm --prefix ./src/main/resources/${RESOURCES_DIR} install --omit=dev \
   && make copy-uswds; \
    fi

# Generate out/**. No --serve, so the generator exits after writing rather than holding the build.
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt "run ${SITE_FLAGS}"

# ---- stage 3: runtime -------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
ARG APP_DIR
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/${APP_DIR}/out /usr/share/nginx/html

# Where to open the app, printed once at container start. Nothing else in this image says so:
# there is no `--serve` dev-server banner here, so without this `docker compose up`/`docker compose
# logs` ends with an access log and no address.
#
# nginx's own entrypoint runs every *executable* /docker-entrypoint.d/*.sh in name order before
# exec'ing nginx, so the 99- prefix puts this last, immediately above the first request. It must be
# executable or the entrypoint prints "not executable, ignoring" and moves on — hence --chmod.
#
# APP_PORT is the HOST's published port, which the container has no way to discover: it sees only
# its own :80. docker-compose.yml maps 3003:80 and passes the same number back in as an environment
# override, so change the two together.
ENV APP_PORT=3003
COPY --chmod=0755 <<'EOF' /docker-entrypoint.d/99-print-url.sh
#!/bin/sh
printf '\n\033[32m\033[1m✓\033[0m \033[1mCredit Assistant (EITC)\033[0m \033[36mready\033[0m\n'
printf '  \033[1mFlow:\033[0m        \033[36mhttp://localhost:%s/app/eitc/\033[0m\n' "$APP_PORT"
printf '  \033[1mBrowse All:\033[0m  \033[36mhttp://localhost:%s/app/eitc/all-screens/\033[0m\n' "$APP_PORT"
if [ ! -f /usr/share/nginx/html/app/eitc/index.html ]; then
  printf '  \033[33m⚠ no site in the web root yet — the watcher is still generating it; refresh once it lands\033[0m\n'
fi
printf '\n'
EOF

EXPOSE 80
