FROM node:20.19-alpine AS base
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl

FROM base AS deps
ENV DATABASE_URL=postgresql://portfolio_scope:portfolio_scope@localhost:5432/portfolio_scope?schema=public
ENV DIRECT_URL=postgresql://portfolio_scope:portfolio_scope@localhost:5432/portfolio_scope?schema=public
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM base AS builder
ENV DATABASE_URL=postgresql://portfolio_scope:portfolio_scope@localhost:5432/portfolio_scope?schema=public
ENV DIRECT_URL=postgresql://portfolio_scope:portfolio_scope@localhost:5432/portfolio_scope?schema=public
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20.19-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /workspace/public ./public
COPY --from=builder --chown=nextjs:nodejs /workspace/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
