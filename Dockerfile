# Multi-stage build: one image, two entrypoints (web app + live service)

# --- Stage 1: Install dependencies and build ---
FROM node:22-alpine AS build

WORKDIR /app

# Install root dependencies (engine, tsx, typescript)
COPY package.json package-lock.json ./
RUN npm ci

# Install web dependencies
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

# Copy source
COPY . .

# Build web app
RUN cd web && npm run build

# --- Stage 2: Production runtime ---
FROM node:22-alpine

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

# Copy shared strategies
COPY data/shared/ ./data/shared/

# Data volume mount point
VOLUME /app/data

# Default entrypoint: web app
ENV PORT=3000
EXPOSE 3000
CMD ["node", "web/build"]
