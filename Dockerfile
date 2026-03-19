# Multi-stage build: one image, two entrypoints (web app + live service)

# --- Stage 1: Install dependencies and build ---
FROM node:22-slim AS build

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root dependencies (engine, tsx, typescript)
COPY package.json package-lock.json ./
RUN npm ci

# Install web dependencies
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

# Copy source
COPY . .

# Generate strategy docs from TypeScript interfaces
RUN npx tsx src/tools/gen-strategy-docs.ts

# Build web app (git SHA is read by vite.config.ts at build time)
RUN cd web && npm run build

# --- Stage 2: Production runtime ---
FROM node:22-slim

WORKDIR /app

# Install root dependencies (needed for tsx, strategy loading, broker clients)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install web production dependencies
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --omit=dev

# Copy engine source (needed for tsx runtime: strategies, live service, backtest)
COPY src/ ./src/
COPY tsconfig.json ./

# Copy built web app
COPY --from=build /app/web/build ./web/build

# Data volume mount point
VOLUME /app/data

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV PROJECT_ROOT=/app
EXPOSE 3000
CMD ["node", "web/build/index.js"]
