# Railway Deployment Guide

Deploy KP Rück Dashboard to Railway with separate services for database, backend, and frontend.

## Prerequisites

- Railway account: https://railway.app
- Railway CLI (optional): `npm install -g @railway/cli`

## Deployment Architecture

Railway will deploy three separate services:
1. **PostgreSQL** - Managed database
2. **Backend** - FastAPI application
3. **Frontend** - Next.js application

## Deployment Steps

### Method 1: Railway Dashboard (Recommended)

#### 1. Create New Project

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Select your `kp-rueck` repository
4. Railway will create a new project

#### 2. Add PostgreSQL Database

1. In your Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will provision a PostgreSQL instance
4. Note: Railway automatically creates `DATABASE_URL` variable

#### 3. Deploy Backend Service

1. Click "New" → "GitHub Repo" → Select `kp-rueck`
2. Configure the service:
   - **Name**: `backend`
   - **Root Directory**: `/backend`
   - **Build Command**: (Auto-detected from Dockerfile)
   - **Start Command**: `./start.sh`

3. Add environment variables:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://your-frontend-url.railway.app
   PORT=8000
   ```

4. Click "Deploy"

#### 4. Deploy Frontend Service

1. Click "New" → "GitHub Repo" → Select `kp-rueck`
2. Configure the service:
   - **Name**: `frontend`
   - **Root Directory**: `/frontend`
   - **Build Command**: (Auto-detected from Dockerfile)
   - **Start Command**: `node server.js`

3. Add environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend-url.railway.app
   PORT=3000
   ```

4. Click "Deploy"

#### 5. Update CORS Origins

After frontend deploys, copy its URL and update backend's `CORS_ORIGINS`:
```
CORS_ORIGINS=https://your-frontend-url.railway.app
```

### Method 2: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Link to project
railway link

# Deploy backend
cd backend
railway up

# Deploy frontend
cd ../frontend
railway up

# Add database
railway add --database postgresql
```

## Environment Variables

### Backend (`backend` service)

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Auto-linked from PostgreSQL service |
| `CORS_ORIGINS` | `https://your-frontend.railway.app` | Frontend URL for CORS |
| `PORT` | `8000` | Port (Railway sets automatically) |

### Frontend (`frontend` service)

| Variable | Value | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.railway.app` | Backend API URL |
| `PORT` | `3000` | Port (Railway sets automatically) |

## Post-Deployment

### 1. Initialize Database

The backend's `start.sh` script automatically:
- Creates database tables
- Seeds initial data (on first run)

### 2. Verify Deployment

- **Frontend**: https://your-frontend.railway.app
- **Backend API**: https://your-backend.railway.app/docs
- **Health Check**: https://your-backend.railway.app/health

### 3. Monitor Logs

View logs in Railway dashboard:
- Click on each service
- Navigate to "Deployments" tab
- Click "View Logs"

## Service Configuration

Each service has a `railway.json` file:

**Backend** (`backend/railway.json`):
```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health"
  }
}
```

**Frontend** (`frontend/railway.json`):
```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js"
  }
}
```

## Connecting Services

Railway automatically handles:
- **Database → Backend**: Use `${{Postgres.DATABASE_URL}}` reference
- **Backend → Frontend**: Set `NEXT_PUBLIC_API_URL` to backend URL
- **Service Discovery**: Internal networking between services

## Custom Domains

1. Go to service settings
2. Click "Settings" → "Domains"
3. Click "Generate Domain" or add custom domain
4. Update CORS and API URL environment variables accordingly

## Scaling

Railway allows horizontal scaling:
1. Go to service settings
2. Adjust "Replicas" count
3. Backend and Frontend can scale independently

## Database Backups

Railway PostgreSQL includes:
- Automatic daily backups
- Point-in-time recovery
- Manual snapshot creation

## Database Reset (If Needed)

If the Railway database contains stale data with incorrect enum values, you can reset it:

### Option 1: Via Railway Dashboard

1. Go to your Railway project
2. Click on the PostgreSQL service
3. Go to "Data" tab
4. Click "Reset Database" (this will delete all data and tables)
5. Redeploy the backend service to trigger automatic re-seeding

### Option 2: Via Railway CLI

```bash
# Connect to Railway project
railway link

# Open Railway shell for backend service
railway run bash

# Inside the shell, reset database
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Exit shell
exit

# Trigger redeployment to re-seed
railway up
```

### Option 3: Manual SQL Reset

1. Open Railway dashboard
2. Navigate to PostgreSQL service → "Data" tab
3. Run SQL query:
   ```sql
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   ```
4. Redeploy backend service

After reset, the backend's `start.sh` script will automatically:
- Run Alembic migrations to recreate tables
- Seed initial data with correct values

## Troubleshooting

### Backend not connecting to database

1. Check `DATABASE_URL` is set correctly
2. Verify PostgreSQL service is running
3. Check logs for connection errors

### Frontend can't reach backend

1. Verify `NEXT_PUBLIC_API_URL` is set
2. Check backend CORS settings
3. Ensure backend service is deployed and healthy

### Build failures

1. Check Dockerfile syntax
2. Verify all dependencies are listed
3. Review build logs in Railway dashboard

## Costs

Railway pricing (as of 2024):
- **Hobby Plan**: $5/month + usage
- **PostgreSQL**: ~$5-10/month
- **Compute**: Pay for what you use
- **Bandwidth**: Generous free tier

## Production Checklist

- [ ] Set strong PostgreSQL password
- [ ] Enable Railway's built-in DDoS protection
- [ ] Set up custom domain with SSL
- [ ] Configure environment variables
- [ ] Enable automatic deployments from `main` branch
- [ ] Set up monitoring and alerts
- [ ] Configure backups retention policy
- [ ] Review and optimize resource allocation

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- GitHub Issues: https://github.com/railwayapp/railway/issues
