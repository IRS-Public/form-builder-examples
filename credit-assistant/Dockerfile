# syntax=docker/dockerfile:1
#
# credit-assistant — prod-like static image.
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
#     -f examples/credit-assistant/Dockerfile .
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

# ---- stage 1: generate the static credit-assistant site --------------------------
FROM sbt-base AS build
# gov.irs::formative resolves from GitHub Packages, which requires auth even to read.
# Pass the token as a build secret so it never lands in an image layer:
#   docker build --secret id=github_token,env=GITHUB_TOKEN --build-arg GITHUB_OWNER=... .
ARG GITHUB_OWNER
ARG GITHUB_ACTOR
ENV GITHUB_OWNER=${GITHUB_OWNER} GITHUB_ACTOR=${GITHUB_ACTOR}
WORKDIR /build/credit-assistant
COPY examples/credit-assistant/ ./
# No `make copy-fg` step: vendor/fact-graph/factgraph-3.1.0.js is committed. fact-graph is a
# separate open-source repo now, so refreshing the bundle is `make copy-fg` against a checkout of
# it rather than a build stage here.
# Equivalent of `make copy-shared-ui`: vendor the workspace UI from the sibling
# packages/ui (see docker-compose.yml — same reason this build's context is the
# repo root, not just credit-assistant/). Mirrors the bundle-dir layout (global-nav/,
# audit-panel/, shared/, tool-panels/, flow-runtime/, each with js/styles/…).
#
# The theme is NOT here: it ships inside the formative jar and the `sbt run` below
# extracts it into out/.../resources/vendor/formative/. See FormativeAssets.scala.
#
# One COPY of the whole src/ tree rather than one per bundle: the per-bundle list had to
# be kept in step with taxpert by hand, and a bundle missing from it produced an image
# whose UI was silently incomplete. `make copy-shared-ui` derives the list the same way.
#
# Wipe first, exactly as the Makefile recipe does: COPY merges into the destination
# rather than replacing it, so without this a file deleted or renamed in taxpert/src
# could survive in the image as a stale vendored copy. (The mirror is untracked and
# .dockerignore'd, so this only bites when a developer's working tree carries one.)
RUN rm -rf ./src/main/resources/credit-assistant/website-static/vendor/taxpert
COPY packages/ui/src ./src/main/resources/credit-assistant/website-static/vendor/taxpert
# Generate out/app/eitc/** with the audit UI baked in (no --serve -> exits after writing).
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    --mount=type=secret,id=github_token \
    GITHUB_TOKEN="$(cat /run/secrets/github_token)" \
    sbt 'run --auditMode --allScreens --scenarioMode'

# ---- stage 2: runtime ------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY examples/credit-assistant/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/credit-assistant/out /usr/share/nginx/html
EXPOSE 80
