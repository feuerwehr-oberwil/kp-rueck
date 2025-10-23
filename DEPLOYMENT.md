# KP Rück Dashboard - Deployment Guide

Complete guide for deploying the KP Rück Dashboard to Railway.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Deployment Steps](#deployment-steps)
- [Post-Deployment](#post-deployment)
- [Troubleshooting](#troubleshooting)

## Quick Start

1. **Fork or clone** this repository
2. **Create a Railway account** at https://railway.app
3. **Deploy PostgreSQL** database in Railway
4. **Deploy backend** service pointing to `/backend` directory
5. **Deploy frontend** service pointing to `/frontend` directory
6. **Configure environment variables** for each service
7. **Access your deployed application**

## Prerequisites

- [Railway account](https://railway.app)
- GitHub account with access to this repository
- Basic understanding of environment variables

## Architecture

The application consists of three Railway services:

```
┌─────────────────┐
│   PostgreSQL    │  Managed database
│    Database     │
└────────┬────────┘
         │
         │ DATABASE_URL
         │
┌────────▼────────┐
│     Backend     │  FastAPI (Python)
│   Port: 8000    │  - REST API
└────────┬────────┘  - Database ORM
         │           - CORS enabled
         │
         │ API calls
         │
┌────────▼────────┐
│    Frontend     │  Next.js (React)
│   Port: 3000    │  - Server-side rendering
└─────────────────┘  - Static assets
```

## Environment Variables

### Backend Service

Create these variables in your Railway backend service:

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | PostgreSQL connection string (auto-linked) |
| `CORS_ORIGINS` | `https://your-app.up.railway.app` | Comma-separated list of allowed frontend URLs |
| `SEED_DATABASE` | `true` | Set to `true` on first deploy to seed initial data |

**Optional variables:**
- `HOST` - Server host (default: `0.0.0.0`)
- `PORT` - Server port (Railway sets this automatically)
- `API_V1_PREFIX` - API route prefix (default: `/api`)
- `PROJECT_NAME` - API project name (default: `KP Rück API`)

### Frontend Service

Create these variables in your Railway frontend service:

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.up.railway.app` | Full URL to backend API |

**Optional variables:**
- `PORT` - Server port (Railway sets this automatically)

## Deployment Steps

### Step 1: Prepare Repository

Ensure your code is pushed to GitHub:

```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### Step 2: Create Railway Project

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Authenticate with GitHub
4. Select the `kp-rueck` repository
5. Railway creates a new project

### Step 3: Add PostgreSQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Railway provisions the database
4. Note: `DATABASE_URL` is automatically available as `${{Postgres.DATABASE_URL}}`

### Step 4: Deploy Backend Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Configure the service:
   - **Service Name**: `backend`
   - **Root Directory**: `/backend`
   - **Builder**: Dockerfile (auto-detected)

4. **Add Environment Variables**:

   Go to the **Variables** tab and add:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://temporary-placeholder.com
   SEED_DATABASE=true
   ```

   ⚠️ **Note**: You'll update `CORS_ORIGINS` after deploying the frontend

5. Click **"Deploy"**

6. **Get Backend URL**:
   - Go to **Settings** → **Networking** → **Public Networking**
   - Click **"Generate Domain"**
   - Copy the URL (e.g., `https://backend-production-xxxx.up.railway.app`)

### Step 5: Deploy Frontend Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Configure the service:
   - **Service Name**: `frontend`
   - **Root Directory**: `/frontend`
   - **Builder**: Dockerfile (auto-detected)

4. **Add Environment Variables**:

   Go to the **Variables** tab and add:

   ```
   NEXT_PUBLIC_API_URL=https://your-backend-production-xxxx.up.railway.app
   ```

   Replace with your actual backend URL from Step 4.

5. Click **"Deploy"**

6. **Get Frontend URL**:
   - Go to **Settings** → **Networking** → **Public Networking**
   - Click **"Generate Domain"**
   - Copy the URL (e.g., `https://frontend-production-xxxx.up.railway.app`)

### Step 6: Update Backend CORS

Now that you have the frontend URL, update the backend:

1. Go to **Backend Service** → **Variables**
2. Update `CORS_ORIGINS`:
   ```
   CORS_ORIGINS=https://your-frontend-production-xxxx.up.railway.app
   ```
3. The backend will automatically redeploy

### Step 7: Verify Deployment

1. **Frontend**: Visit your frontend URL
   - Should display the KP Rück Dashboard
   - All UI should load properly

2. **Backend API Docs**: Visit `https://your-backend-url.up.railway.app/docs`
   - Should display Swagger API documentation

3. **Health Check**: Visit `https://your-backend-url.up.railway.app/health`
   - Should return `{"status": "healthy"}`

## Post-Deployment

### Database Seeding

On first deployment with `SEED_DATABASE=true`, the backend automatically:
- Creates all database tables
- Seeds initial data (personnel, materials, operations)

After successful deployment, you can set `SEED_DATABASE=false` to prevent re-seeding.

### Custom Domains

To use custom domains:

1. Go to service **Settings** → **Domains**
2. Click **"Custom Domain"**
3. Enter your domain (e.g., `dashboard.example.com`)
4. Configure DNS records as instructed by Railway
5. Update `CORS_ORIGINS` in backend with new domain

### Automatic Deployments

Railway automatically deploys on push to `main` branch:

1. Make changes locally
2. Commit and push to GitHub
3. Railway detects changes and redeploys

To change deployment branch:
- Go to **Settings** → **Source**
- Update **Branch** setting

## Monitoring & Logs

### View Logs

1. Click on a service (backend or frontend)
2. Go to **Deployments** tab
3. Click on latest deployment
4. Click **"View Logs"**

### Metrics

Railway provides built-in metrics:
- CPU usage
- Memory usage
- Network traffic
- Request count

Access via the **Metrics** tab for each service.

## Scaling

### Horizontal Scaling

Railway supports multiple replicas:

1. Go to service **Settings**
2. Under **Deploy**, adjust **Replicas**
3. Each replica runs independently

### Vertical Scaling

Railway automatically scales resources based on usage.

To set resource limits:
1. Go to **Settings** → **Resources**
2. Adjust CPU and memory allocations

## Troubleshooting

### Backend Deployment Fails

**Issue**: Docker build fails

**Solution**:
1. Check build logs in Railway
2. Verify `pyproject.toml` has all dependencies
3. Ensure `start.sh` is executable
4. Check Dockerfile syntax

### Frontend Can't Connect to Backend

**Issue**: API calls fail with CORS errors

**Solution**:
1. Verify `NEXT_PUBLIC_API_URL` is set correctly
2. Check backend `CORS_ORIGINS` includes frontend URL
3. Ensure both services are deployed and running
4. Check backend logs for CORS errors

### Database Connection Issues

**Issue**: Backend can't connect to database

**Solution**:
1. Verify `DATABASE_URL` is set as `${{Postgres.DATABASE_URL}}`
2. Check PostgreSQL service is running
3. Review backend logs for connection errors
4. Ensure database service is linked to backend

### Environment Variables Not Working

**Issue**: Variables not being picked up

**Solution**:
1. Check variable names are exact (case-sensitive)
2. Redeploy service after adding variables
3. For Next.js, ensure public vars start with `NEXT_PUBLIC_`
4. Check service logs for missing variable warnings

### Application Crashes on Start

**Issue**: Service keeps restarting

**Solution**:
1. Check logs for error messages
2. Verify start command in `railway.json`
3. Ensure all dependencies are installed
4. Check database migrations ran successfully

## Cost Optimization

### Tips for Reducing Costs

1. **Use 1 replica** during development
2. **Scale down** during off-hours (if manual scaling)
3. **Monitor metrics** to right-size resources
4. **Use Railway's sleep feature** for dev environments
5. **Optimize Docker images** (multi-stage builds already implemented)

### Estimated Monthly Costs

- **PostgreSQL**: ~$5-10
- **Backend Service**: ~$5-15 (depending on traffic)
- **Frontend Service**: ~$5-15 (depending on traffic)
- **Total**: ~$15-40/month for moderate usage

## Security Checklist

- [ ] Set strong database password (Railway auto-generates)
- [ ] Configure proper CORS origins (no wildcards in production)
- [ ] Use HTTPS only (Railway provides SSL automatically)
- [ ] Review and limit environment variable exposure
- [ ] Enable Railway's DDoS protection
- [ ] Set up monitoring and alerts
- [ ] Regularly update dependencies
- [ ] Enable automatic security updates in Railway

## Support & Resources

- **Railway Documentation**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway
- **Railway Status**: https://status.railway.app
- **GitHub Issues**: Report bugs in this repository

## Quick Reference Commands

```bash
# Test backend locally
cd backend
docker build -t kp-rueck-backend .
docker run -p 8000:8000 --env-file .env kp-rueck-backend

# Test frontend locally
cd frontend
docker build -t kp-rueck-frontend .
docker run -p 3000:3000 --env-file .env.local kp-rueck-frontend

# View Railway logs (using CLI)
railway logs --service backend
railway logs --service frontend

# Deploy manually (using CLI)
cd backend && railway up
cd frontend && railway up
```

## Additional Documentation

- See [RAILWAY.md](./RAILWAY.md) for detailed Railway-specific configuration
- See [README.md](./README.md) for local development setup
- See [PERSISTENCE_UPDATE.md](./PERSISTENCE_UPDATE.md) for database persistence details
