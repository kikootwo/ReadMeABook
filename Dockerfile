# ReadMeABook - Production Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache libc6-compat openssl

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies for building
RUN apk add --no-cache libc6-compat openssl

# Copy package files and install all dependencies (including dev)
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

# Copy application source
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Generate Prisma client AFTER copying (ensures fresh generation from schema)
# Prisma generate requires DATABASE_URL to be set, but doesn't actually connect
# Provide a dummy URL for build time - actual URL comes from docker-compose.yml at runtime
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
RUN npx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Disable Turbopack - use Webpack which properly handles server-only packages
ENV TURBOPACK=0

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    openssl \
    curl \
    ffmpeg \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3030
ENV HOSTNAME="0.0.0.0"

# Copy package.json for reference
COPY --from=builder /app/package.json ./package.json

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma schema
COPY --from=builder /app/prisma ./prisma

# Copy Prisma generated client from builder (custom output path)
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma

# Copy production node_modules from deps stage (includes all runtime dependencies)
COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma dependencies from builder
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Create directories for volumes and set ownership only for writable directories
RUN mkdir -p /app/config /app/cache /downloads /media /app/.next/cache && \
    chown -R nextjs:nodejs /app/config /app/cache /downloads /media /app/.next/cache

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3030

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3030/api/health || exit 1

# Run database setup and start server
CMD sh -c 'echo "🚀 Starting ReadMeABook..." && \
    ./node_modules/.bin/prisma db push --skip-generate --accept-data-loss && \
    echo "✨ Starting server on port 3030..." && \
    node server.js & \
    SERVER_PID=$! && \
    echo "⏳ Waiting for server to be ready..." && \
    sleep 5 && \
    echo "🔧 Initializing application services..." && \
    curl -f http://localhost:3030/api/init || echo "⚠️  Warning: Failed to initialize services" && \
    echo "✅ Server running with PID $SERVER_PID" && \
    wait $SERVER_PID'
