# Builds the Webamp demo as a static site.
#
# This repo is a pnpm monorepo, and two things trip up an auto-detected build:
#
#   1. A plain `pnpm install` installs every workspace package, including
#      `skin-database`, which depends on sqlite3. sqlite3 has no prebuilt
#      binary for this platform and compiles from source, which needs Python.
#      The demo doesn't use that package at all, so we install only the
#      demo's slice of the workspace.
#
#   2. `webamp-demo` imports `winamp-eqf` and `ani-cursor` as workspace
#      packages. They're TypeScript and must be compiled before Vite can
#      resolve their entry points, otherwise the build fails with
#      "Failed to resolve entry for package".
#
# Using the full node image (not -slim) so native modules have a toolchain
# available if the dependency tree ever grows one.
FROM node:22 AS build

WORKDIR /app

# Corepack picks up the pnpm version pinned in package.json's "packageManager".
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The root package's devDependencies include puppeteer, which otherwise
# downloads a full Chrome build we never use.
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY . .

RUN pnpm install --frozen-lockfile --filter webamp-demo... --filter .
RUN pnpm --filter winamp-eqf --filter ani-cursor run build
RUN pnpm --filter webamp-demo build

FROM nginx:alpine

COPY --from=build /app/packages/webamp-demo/dist /usr/share/nginx/html

EXPOSE 80
