# Component: E2E fake-arr image (fakes for Prowlarr, qBittorrent, SABnzbd, Plex)
# Documentation: documentation/testing/e2e-harness.md
#
# Build context: e2e/ (needs fake-arr/, fixtures/, scenarios/). ffmpeg lives only in the
# throwaway "fixtures" stage; the runtime image is node:24-alpine3.23 + ~250 KB of fixtures.
# Fixture metadata (title/author) is resolved from Audnexus by ASIN at build time; pass
# --build-arg FIXTURE_METADATA=test/offline-metadata.json to build offline.

FROM node:24-alpine3.23@sha256:e44c87c7dd212720eb00469aeac89504ca2be77b8f0d6dbffb30665d5fcc59e1 AS fixtures
RUN apk add --no-cache ffmpeg
WORKDIR /build
COPY fixtures/ ./fixtures/
ARG FIXTURE_METADATA=
RUN node fixtures/generate.mjs --out /fixtures ${FIXTURE_METADATA:+--metadata fixtures/${FIXTURE_METADATA}}

FROM node:24-alpine3.23@sha256:e44c87c7dd212720eb00469aeac89504ca2be77b8f0d6dbffb30665d5fcc59e1
LABEL org.opencontainers.image.title="rmab-e2e-fake-arr" rmab-e2e="true"
WORKDIR /app
COPY fake-arr/package.json ./
COPY fake-arr/src/ ./src/
COPY scenarios/ /scenarios/
COPY --from=fixtures /fixtures /fixtures
ENV NODE_ENV=production FIXTURES_DIR=/fixtures SCENARIOS_DIR=/scenarios DOWNLOADS_DIR=/downloads MEDIA_DIR=/media
EXPOSE 9696 9797 8081 8085 32400 9898 9999
HEALTHCHECK --interval=2s --timeout=2s --retries=15 CMD wget -q -O /dev/null http://127.0.0.1:9999/__control/health || exit 1
# Runs as root on purpose: it chowns the shared named volumes to PUID:PGID (see prepareVolumes).
CMD ["node", "src/server.js"]
