#!/bin/bash

# ProviderCard Deployment Script for Vercel
# This script guides you through deploying to Vercel

set -e

echo "🚀 ProviderCard Deployment Script"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -d "frontend" ]; then
    echo "❌ Error: Must run from project root (where frontend/ directory exists)"
    exit 1
fi

cd frontend

echo "📋 Pre-deployment checklist:"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found. Installing dependencies..."
    npm install
else
    echo "✅ Dependencies installed"
fi

# Check if Prisma Client is generated
if [ ! -d "node_modules/@prisma/client" ]; then
    echo "⚠️  Prisma Client not generated. Generating..."
    npx prisma generate
else
    echo "✅ Prisma Client generated"
fi

# Test build
echo ""
echo "🔨 Testing build locally..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed! Fix errors before deploying."
    exit 1
fi

echo ""
echo "✅ All pre-deployment checks passed!"
echo ""
echo "📌 Next steps:"
echo ""
echo "1. Login to Vercel (if not already):"
echo "   vercel login"
echo ""
echo "2. Deploy to production:"
echo "   vercel --prod --yes"
echo ""
echo "3. After deployment, set up database:"
echo "   a. Create Vercel Postgres in dashboard"
echo "   b. Connect to your project"
echo "   c. Pull env vars: vercel env pull .env.local"
echo "   d. Push schema: npm run db:push"
echo "   e. Seed data: npm run db:seed"
echo ""
echo "Or follow the detailed guide: DEPLOY.md"
echo ""

# Ask if user wants to deploy now
read -p "Deploy to Vercel now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Deploying to Vercel..."
    vercel --prod --yes
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "🎉 Deployment successful!"
        echo ""
        echo "⚠️  Don't forget to:"
        echo "1. Create and connect Vercel Postgres database"
        echo "2. Run: vercel env pull .env.local"
        echo "3. Run: npm run db:push"
        echo "4. Run: npm run db:seed"
        echo ""
        echo "See DEPLOY.md for detailed instructions."
    else
        echo ""
        echo "❌ Deployment failed. Check errors above."
        echo ""
        echo "Common issues:"
        echo "- Not logged in: Run 'vercel login'"
        echo "- Network issues: Check internet connection"
        echo "- Build errors: Run 'npm run build' to debug"
    fi
else
    echo ""
    echo "Deployment cancelled. When ready, run:"
    echo "  vercel --prod --yes"
fi
