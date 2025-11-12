#!/bin/sh
set -e

echo "🚀 ReadMeABook - Starting application..."
echo ""

# Run database migrations
echo "📦 Setting up database..."
if npx prisma db push --skip-generate --accept-data-loss; then
  echo "✅ Database schema synced successfully"
else
  echo "❌ Database setup failed"
  exit 1
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
