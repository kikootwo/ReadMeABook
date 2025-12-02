#!/bin/bash
# App startup wrapper for unified container
# Starts Next.js server and initializes services

echo "[App] Starting Next.js server..."
cd /app

# Start server in background
node server.js &
SERVER_PID=$!

echo "[App] Waiting for server to be ready..."
sleep 5

# Initialize application services (creates default scheduled jobs)
echo "[App] Initializing application services..."
curl -f http://localhost:3030/api/init || echo "[App] ⚠️  Warning: Failed to initialize services"

echo "[App] Server ready with PID $SERVER_PID"

# Wait for server process
wait $SERVER_PID
