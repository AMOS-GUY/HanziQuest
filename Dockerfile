# HanziQuest production image (Node 24, `next start`).
# Build:  docker build -t hanziquest .
# Run:    docker run -p 3000:3000 --env-file .env.production hanziquest
# Migrations run separately as a release step (see docs/DEPLOYMENT.md), never on container start.
# NOTE: not built on the development machine (no Docker there); CI builds it on every push.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
# prisma.config.ts requires DATABASE_URL even for `prisma generate` (run by postinstall).
ENV CI=true DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY . .
# Build-time only placeholders: the real values are provided at run time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    AUTH_URL="https://build.invalid" \
    SKIP_ENV_CHECK="true" \
    NEXT_TELEMETRY_DISABLED=1
# Dev dependencies are kept: next.config.ts is TypeScript and the release step uses the Prisma CLI.
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 hanziquest
COPY --from=build --chown=hanziquest /app/package.json ./package.json
COPY --from=build --chown=hanziquest /app/node_modules ./node_modules
COPY --from=build --chown=hanziquest /app/.next ./.next
COPY --from=build --chown=hanziquest /app/public ./public
COPY --from=build --chown=hanziquest /app/src/generated ./src/generated
COPY --from=build --chown=hanziquest /app/next.config.ts ./next.config.ts
# For the release step: `docker run --rm --env-file … hanziquest npx prisma migrate deploy`
COPY --from=build --chown=hanziquest /app/prisma ./prisma
COPY --from=build --chown=hanziquest /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=hanziquest /app/tsconfig.json ./tsconfig.json
USER hanziquest
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-p", "3000"]
