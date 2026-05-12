# syntax=docker/dockerfile:1.6

# ---------- Stage 1: build the SvelteKit frontend ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (incl. dev) for the build step.
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources needed for `vite build`.
COPY svelte.config.js vite.config.ts tsconfig.json postcss.config.js tailwind.config.js ./
COPY src ./src
COPY static ./static

# Produce ./build (adapter-node output: handler.js, index.js, client/, server/, ...)
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Install only production deps (tsx, ws, pg, groq-sdk, chrono-node, dotenv).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code + built frontend + schema + scripts.
COPY backend ./backend
COPY scripts ./scripts
COPY schema.sql ./schema.sql
COPY --from=builder /app/build ./build

EXPOSE 3000

# Single port serves both the HTTP frontend and the /ws WebSocket.
CMD ["npm", "run", "start"]
