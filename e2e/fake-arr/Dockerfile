# Component: E2E fake-arr image (fakes for Prowlarr, qBittorrent, SABnzbd, Plex)
# Documentation: documentation/testing/e2e-harness.md
#
# Build context: e2e/ (needs fake-arr/, fixtures/, scenarios/). ffmpeg lives only in the
# throwaway "fixtures" stage; the runtime image is node:20-alpine + ~250 KB of fixtures.
# Fixture metadata (title/author) is resolved from Audnexus by ASIN at build time; pass
# --build-arg FIXTURE_METADATA=test/offline-metadata.json to build offline.

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS fixtures
RUN apk add --no-cache ffmpeg
WORKDIR /build
COPY fixtures/ ./fixtures/
ARG FIXTURE_METADATA=
RUN node fixtures/generate.mjs --out /fixtures ${FIXTURE_METADATA:+--metadata fixtures/${FIXTURE_METADATA}}

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
LABEL org.opencontainers.image.title="rmab-e2e-fake-arr" rmab-e2e="true"
WORKDIR /app
COPY fake-arr/package.json ./
COPY fake-arr/src/ ./src/
COPY scenarios/ /scenarios/
COPY --from=fixtures /fixtures /fixtures
ENV NODE_ENV=production FIXTURES_DIR=/fixtures SCENARIOS_DIR=/scenarios DOWNLOADS_DIR=/downloads MEDIA_DIR=/media
EXPOSE 9696 9797 8081 8085 32400 9999
HEALTHCHECK --interval=2s --timeout=2s --retries=15 CMD wget -q -O /dev/null http://127.0.0.1:9999/__control/health || exit 1
# Runs as root on purpose: it chowns the shared named volumes to PUID:PGID (see prepareVolumes).
CMD ["node", "src/server.js"]
