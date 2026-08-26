# syntax=docker/dockerfile:1
#
# Benefits Enrollment: a prod-like static image.
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
ARG APP_DIR=benefits-enrollment
ARG RESOURCES_DIR=benefits-enrollment
ARG SITE_FLAGS="--auditMode --allScreens --scenarioMode"
ARG VENDOR_USWDS=1
ARG SBT_VERSION=1.11.4

# The build context is this application's own directory. fact-graph, form-builder and taxpert are
# clones of three other repositories rather than parts of this one, so each arrives as its own named
# build context. docker-compose.yml passes all three; a plain `docker build` needs them by hand:
#
#   docker build \
#     --build-context fact_graph=../../fact-graph \
#     --build-context form-builder=../../form-builder \
#     --build-context taxpert=../../taxpert/packages/ui \
#     -t benefits-enrollment .
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
COPY --from=libs \
     /build/fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs.map \
     ./src/main/resources/${RESOURCES_DIR}/website-static/vendor/fact-graph/main.mjs.map

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
EXPOSE 80
