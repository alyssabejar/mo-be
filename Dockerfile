# One image per service: docker build --build-arg SERVICE=identity -t mamamo/identity .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages packages
COPY services services
COPY scripts scripts
RUN pnpm install --frozen-lockfile
ARG SERVICE
RUN test -n "$SERVICE" && cd services/$SERVICE && node ../../scripts/build-service.mjs

FROM node:22-bookworm-slim
ARG SERVICE
WORKDIR /app
ENV NODE_ENV=production PORT=4000
# The bundle carries its dependencies; migrations sit next to it (../drizzle from dist/).
COPY --from=build /repo/services/${SERVICE}/dist ./dist
COPY --from=build /repo/services/${SERVICE}/drizzle ./drizzle
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]
