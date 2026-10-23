# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 HRIS_DEPLOYMENT=production
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HRIS_DEPLOYMENT=production HRIS_DATA_DIR=/var/lib/hris HRIS_ALLOW_SETUP=0 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/lib/db.ts /app/lib/backup-format.ts /app/lib/onboarding-reminders.ts /app/lib/onboarding-date.ts /app/lib/readiness.ts ./lib/
COPY --from=build --chown=node:node /app/scripts/start-production.mjs /app/scripts/backup.mjs /app/scripts/recover-admin.mjs /app/scripts/onboarding-reminders.mjs /app/scripts/backup-maintenance.mjs /app/scripts/operations-check.mjs ./scripts/
RUN mkdir -p /var/lib/hris && chown node:node /var/lib/hris && rm -rf /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
