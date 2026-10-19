# Component: E2E Playwright runner image (the browser never runs on the host)
# Documentation: documentation/testing/e2e-harness.md
#
# Build context: e2e/ of the TRUSTED checkout (allowlist in runner/Dockerfile.dockerignore).
# Base: the official Playwright image for the pinned @playwright/test version, pinned by digest.
# Runs as pwuser on the stack + control networks only; evidence is copied out with `docker cp`.

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
LABEL rmab-e2e="true"
WORKDIR /harness
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json playwright.config.ts bootstrap.ts ./
COPY lib/harness.ts lib/exec-client.cjs lib/
COPY specs/ specs/
RUN mkdir /evidence && chown -R pwuser:pwuser /evidence /harness
USER pwuser
ENV E2E_EVIDENCE_DIR=/evidence CI=1
CMD ["npx", "playwright", "test", "-c", "playwright.config.ts"]
