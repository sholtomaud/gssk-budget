# Playwright's official image: Chromium and its system libraries are already
# installed, and so are git, ssh and ca-certificates — which `npm install` needs
# to fetch the GSSK kernel, a git dependency. node:*-slim has none of them, and
# npm reports their absence only as "an unknown git error".
#
# Keep this tag in step with the @playwright/test version in package-lock.json —
# Playwright refuses to run against a browser build it did not ship with.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Install dependencies at image-build time for a warm layer cache. The full
# source is mounted at runtime, so only the package files are copied here.
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# Default command — overridden per-target in the Makefile.
CMD ["npm", "run", "dev", "--", "--host"]
