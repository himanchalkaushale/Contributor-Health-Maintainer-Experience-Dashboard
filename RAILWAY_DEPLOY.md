# Railway Deployment - Quick Reference

## 🚂 Step-by-Step Railway Deployment

### 1. Deploy to Railway
1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select: `Contributor-Health-Maintainer-Experience-Dashboard`
4. Railway will auto-detect 2 services:
   - **Backend** (Python/FastAPI)
   - **Frontend** (Node.js/Vite)

### 2. Configure Backend Service

Click on the **backend service** → Settings → Variables

Add these environment variables:
```
GITHUB_TOKEN=ghp_your_token_here
GEMINI_API_KEY=your_gemini_key_here
DATABASE_URL=sqlite:///./sql_app.db
```

**Get your tokens:**
- GitHub Token: https://github.com/settings/tokens (needs `repo` scope)
- Gemini API Key: https://aistudio.google.com/app/apikey

### 3. Wait for Backend to Deploy

Railway will:
- Install Python dependencies from `requirements.txt`
- Start FastAPI with uvicorn
- Give you a URL like: `https://contributor-health-api.up.railway.app`

**Copy this URL!** You'll need it for the frontend.

### 4. Configure Frontend Service

Click on the **frontend service** → Settings → Variables

Add this environment variable:
```
VITE_API_URL=https://your-backend-url.up.railway.app/api
```

**Important:** Replace `your-backend-url` with the actual Railway URL from step 3!

### 5. Redeploy Frontend

After adding the environment variable:
- Railway will auto-redeploy
- Wait ~2 minutes for build to complete

### 6. Get Your Live URLs

You'll have 2 URLs:
- **Frontend**: `https://contributor-health-frontend.up.railway.app` (your main app)
- **Backend**: `https://contributor-health-api.up.railway.app` (API only)

**Use the Frontend URL for your hackathon submission!**

---

## ✅ Verification Checklist

After deployment, test these:

1. **Frontend loads**: Open your Railway frontend URL
2. **Add a repo**: Try `octocat/Hello-World`
3. **Check sync progress**: Should show real-time progress bar
4. **Test Smart Nudge**: Go to Bottlenecks → Click "Draft Nudge"

---

## 🐛 Troubleshooting

### "Failed to fetch" error
- Check that `VITE_API_URL` in frontend matches your backend URL
- Make sure backend URL ends with `/api`

### Backend won't start
- Verify `GITHUB_TOKEN` and `GEMINI_API_KEY` are set
- Check Railway logs for errors

### Database errors
- Railway provides persistent disk automatically
- SQLite will be created on first run

---

## 💰 Railway Free Tier

- **$5 free credit/month**
- **No sleep** (unlike Render)
- **Persistent storage** included
- Perfect for hackathon demos!

---

## 📝 For Your Devpost Submission

**Live Demo URL**: Use your Railway frontend URL

**Example:**
```
https://contributor-health-frontend.up.railway.app
```

**Note in submission:**
"Deployed on Railway with persistent SQLite database and real-time sync capabilities."
