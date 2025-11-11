#!/bin/sh
set -e

echo "🚀 ReadMeABook - Starting application..."
echo ""

# Run database migrations
echo "📦 Running database migrations..."
if npx prisma migrate deploy; then
  echo "✅ Migrations completed successfully"
else
  echo "⚠️  Migrations failed or no migrations to apply"
fi
echo ""

# Generate Prisma client (in case schema changed)
echo "🔧 Generating Prisma client..."
if npx prisma generate; then
  echo "✅ Prisma client generated"
else
  echo "⚠️  Prisma client generation failed"
fi
echo ""

echo "✨ Application ready - starting server..."
echo "📍 Health check: http://localhost:3030/api/health"
echo "🔧 Setup wizard: http://localhost:3030/setup"
echo ""

# Execute the CMD
exec "$@"
