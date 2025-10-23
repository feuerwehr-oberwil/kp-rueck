# Railway Setup Instructions - Quick Fix

## The Dockerfile Issue

If you're getting "Dockerfile does not exist", follow these steps:

## Backend Service Setup

### Option 1: UI Configuration (Recommended)

1. **Create Backend Service**
   - In Railway, click "+ New"
   - Select "GitHub Repo"
   - Choose your repository
   - Name it: `backend`

2. **Configure Service Settings**
   - Go to **Settings** tab
   - Under **Source**:
     - Root Directory: `/backend` ✅
     - Branch: `main`

3. **Build Settings** (Important!)
   - Under **Build** section:
     - Builder: `Dockerfile`
     - Dockerfile Path: Leave empty or set to `Dockerfile` (no leading ./ or /)
     - Build Command: Leave empty (Docker handles this)

4. **Deploy Settings**
   - Under **Deploy** section:
     - Start Command: `./start.sh`
     - Health Check Path: `/health`
     - Restart Policy: `On Failure`

5. **Environment Variables**
   - Go to **Variables** tab
   - Add these variables:
     ```
     DATABASE_URL=${{Postgres.DATABASE_URL}}
     CORS_ORIGINS=https://temporary.com
     SEED_DATABASE=true
     ```

6. **Deploy**
   - Click **Deploy** button
   - Watch the logs for any errors

### Option 2: Remove railway.json and Let Railway Auto-detect

If the above doesn't work:

```bash
# Remove railway.json files
git rm backend/railway.json
git rm frontend/railway.json

# Commit and push
git commit -m "Remove railway.json to let Railway auto-detect"
git push origin main

# Then trigger redeploy in Railway
```

## Frontend Service Setup

1. **Create Frontend Service**
   - In Railway, click "+ New"
   - Select "GitHub Repo"
   - Choose your repository
   - Name it: `frontend`

2. **Configure Service Settings**
   - Go to **Settings** tab
   - Under **Source**:
     - Root Directory: `/frontend` ✅
     - Branch: `main`

3. **Build Settings**
   - Under **Build** section:
     - Builder: `Dockerfile`
     - Dockerfile Path: Leave empty or `Dockerfile`
     - Build Command: Leave empty

4. **Deploy Settings**
   - Under **Deploy** section:
     - Start Command: `node server.js`

5. **Environment Variables**
   - Go to **Variables** tab
   - Add:
     ```
     NEXT_PUBLIC_API_URL=https://your-backend-url.up.railway.app
     ```

## Troubleshooting

### Still Getting Dockerfile Error?

**Check 1: Verify Files Are Pushed**
```bash
git ls-files backend/Dockerfile frontend/Dockerfile
```

Should show both files. If not:
```bash
git add backend/Dockerfile frontend/Dockerfile
git commit -m "Add Dockerfiles"
git push origin main
```

**Check 2: Verify Root Directory**

In Railway Settings → Source, make sure:
- Backend: Root Directory = `/backend` (NOT `backend`, must have leading slash)
- Frontend: Root Directory = `/frontend` (NOT `frontend`, must have leading slash)

**Check 3: Delete railway.json**

Sometimes Railway's auto-detection works better without railway.json:

```bash
# Optional: Remove railway.json files
rm backend/railway.json
rm frontend/railway.json
git add -A
git commit -m "Remove railway.json for auto-detection"
git push origin main
```

Then in Railway:
1. Go to Settings → Build
2. Make sure Builder is set to `Dockerfile`
3. Leave Dockerfile Path empty (Railway will find it automatically)
4. Redeploy

**Check 4: Manual Dockerfile Path**

If Railway still can't find it, try these paths in the Dockerfile Path setting:

For Backend:
- Try: `Dockerfile`
- Or: `./Dockerfile`
- Or: `/app/Dockerfile`

For Frontend:
- Try: `Dockerfile`
- Or: `./Dockerfile`
- Or: `/app/Dockerfile`

**Check 5: Use Railway CLI**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Deploy backend
cd backend
railway up

# Deploy frontend
cd ../frontend
railway up
```

## Alternative: Deploy Without railway.json

### Backend (Without railway.json)

In Railway dashboard:
1. Service Settings → Build:
   - Builder: `Dockerfile`
   - Dockerfile Path: (empty)

2. Service Settings → Deploy:
   - Custom Start Command: `sh -c "./start.sh"`

### Frontend (Without railway.json)

In Railway dashboard:
1. Service Settings → Build:
   - Builder: `Dockerfile`
   - Dockerfile Path: (empty)

2. Service Settings → Deploy:
   - Custom Start Command: `node server.js`

## Verification

After deployment:

1. **Check Build Logs**
   - Go to service → Deployments → Latest → View Logs
   - Look for Docker build output
   - Should see "Step 1/X" messages

2. **Check Deploy Logs**
   - Should see your app starting
   - Backend should show "Starting KP Rück Backend..."
   - Frontend should show Next.js startup

3. **Test Endpoints**
   - Backend: `https://your-backend.railway.app/health`
   - Backend API: `https://your-backend.railway.app/docs`
   - Frontend: `https://your-frontend.railway.app`

## Quick Summary

The most common fix:

1. **Set Root Directory with leading slash**: `/backend` not `backend`
2. **Leave Dockerfile Path empty** - let Railway auto-detect
3. **Remove railway.json** if issues persist
4. **Push changes** and redeploy

If all else fails, use the Railway CLI method shown above.
