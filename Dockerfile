# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203
ARG NGINX_IMAGE=nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94

FROM ${NODE_IMAGE} AS client-build
WORKDIR /build/apps/client
COPY apps/client/package.json apps/client/package-lock.json ./
RUN npm ci
COPY apps/client/ ./
# The browser calls the API through the same host as the frontend.
ENV VITE_API_URL=/api
RUN npm run build

FROM ${NODE_IMAGE} AS server
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/server/ ./
ENV NODE_EXTRA_CA_CERTS=/app/apps/server/certs/supabase-ca.crt
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM ${NGINX_IMAGE} AS client
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /build/apps/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
