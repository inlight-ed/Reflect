# Reflect: one image runs the API and serves the web app.
#
#   docker compose build            # see docker-compose.yml
#   docker build -t reflect .       # just the image
#
# NODE_IMAGE can point at a mirror if Docker Hub is not reachable.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- build: install the workspace and build both apps ----------
FROM ${NODE_IMAGE} AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dependencies first, so code changes do not re-download packages.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile

# The web build needs PORT and BASE_PATH (vite.config.ts); the site is served from the root.
RUN PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/shift-market run build \
 && NODE_ENV=production pnpm --filter @workspace/api-server run build

# ---------- migrate: applies the database schema (docker compose run --rm migrate) ----------
FROM build AS migrate
CMD ["pnpm", "--filter", "@workspace/db", "run", "push"]

# ---------- runtime: only the bundled server and the static site ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/web
WORKDIR /app
# The API bundle is self-contained (esbuild), so no node_modules are needed at runtime.
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/shift-market/dist/public ./web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
