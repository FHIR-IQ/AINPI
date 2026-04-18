# Quick Start - Serverless POC Deployment

## 🚀 Deploy in 60 Seconds

```bash
cd frontend
vercel --prod
```

That's it! Your app will be live at a Vercel URL.

## 📋 What You Get

- **Full demo dashboard** with all features
- **Mock data** - no database needed
- **Serverless** - runs on Vercel edge
- **Free** - $0/month on Vercel free tier
- **Fast** - <100ms response times

## 🧪 Test Locally First

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 🔐 Login

Use any credentials (all accepted for POC):
- Email: `demo@example.com`
- Password: `anything`

## ✨ Try Demo Features

1. Click **"Demo"** in navigation
2. Click **"Detect Discrepancies"** - see NPPES comparison
3. Click **"Export FHIR Bundle"** - download JSON
4. Click **"See Time Savings Story"** - view 3-step flow

## 📚 Full Documentation

- [POC_DEPLOYMENT.md](POC_DEPLOYMENT.md) - Complete deployment guide
- [SERVERLESS_REFACTOR_SUMMARY.md](SERVERLESS_REFACTOR_SUMMARY.md) - Technical details
- [DEMO_DASHBOARD.md](DEMO_DASHBOARD.md) - Feature documentation

## ⚡ Key Commands

```bash
# Deploy to production
vercel --prod

# Deploy to preview
vercel

# Run locally
npm run dev

# Build locally
npm run build

# View deployment logs
vercel logs
```

## 🔧 What Changed

**Before:** FastAPI backend on Render + Next.js on Vercel
**After:** All-in-one Next.js app on Vercel

No more:
- ❌ Separate backend deployment
- ❌ Database setup
- ❌ Environment variables
- ❌ Monthly hosting costs

## ✅ Deployment Checklist

- [x] Build passes (`npm run build`)
- [x] All demo features work
- [x] No backend required
- [x] Ready to deploy

## 🆘 Troubleshooting

**Build fails?**
```bash
cd frontend
rm -rf node_modules .next
npm install
npm run build
```

**Demo not working?**
- Check browser console
- Clear localStorage
- Refresh page

## 📊 What's Included

All these work without a backend:
- ✅ Provider profile display (95% complete)
- ✅ 5 connected organizations (BCBS, Medicare, etc.)
- ✅ NPPES discrepancy detection (5-6 differences)
- ✅ FHIR R4 bundle export (download JSON)
- ✅ Time savings calculator (195 hrs/year)
- ✅ Guided 3-step demo flow

## 🎯 Next Steps After Deploy

1. Share Vercel URL with stakeholders
2. Gather feedback on demo features
3. Decide if moving to production
4. See [POC_DEPLOYMENT.md](POC_DEPLOYMENT.md) for production migration

---

**Ready?** Run `vercel --prod` from the `frontend` directory!
