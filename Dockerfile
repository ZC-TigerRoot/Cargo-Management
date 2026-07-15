FROM node:22-alpine AS build
WORKDIR /app
ENV TZ=Asia/Shanghai
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm","start"]
