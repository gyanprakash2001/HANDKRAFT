# HANDKRAFT Week 2 Launch Guide (Azure + MongoDB Atlas)

This is the exact path to launch your backend on Azure App Service with MongoDB Atlas.

## What is already done in this repo

- Azure backend GitHub Action added: `.github/workflows/deploy-backend-azure.yml`
- Backend CORS allowlist support added via `CORS_ORIGINS`
- Backend env template is ready: `server/.env.example`
- Client env template is ready: `client/.env.example`

## Step 1: Create MongoDB Atlas connection

1. Log in to Atlas.
2. Create or reuse a cluster.
3. Go to Database Access and create a DB user.
4. Go to Network Access and add access:
   - For quick start: `0.0.0.0/0`
   - For better security later: restrict to Azure outbound IPs.
5. Copy your connection string from Atlas and keep it ready for `MONGO_URI`.

Example:

```text
mongodb+srv://<dbUser>:<dbPassword>@<cluster>.mongodb.net/handkraft?retryWrites=true&w=majority
```

## Step 2: Create Azure App Service (Node backend)

1. Open Azure Portal.
2. Create `Web App`.
3. Choose these settings:
   - Runtime stack: `Node 20 LTS`
   - OS: `Linux`
   - Region: closest to your users
4. After creation, open the app and note the default URL:

```text
https://<your-app-name>.azurewebsites.net
```

## Step 3: Add backend App Settings in Azure

In Azure Web App -> Settings -> Environment variables, add at least:

```text
NODE_ENV=production
MONGO_URI=<your Atlas URI>
JWT_SECRET=<long-random-secret>
CORS_ORIGINS=https://<your-frontend-domain>
```

If you host web and APK pages on different domains, add both:

```text
CORS_ORIGINS=https://<domain-1>,https://<domain-2>
```

Optional integrations (only if you are actively using them):

```text
RAZORPAY_ENABLED=true
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

NIMBUSPOST_ENABLED=true
NIMBUSPOST_MODE=auto
NIMBUSPOST_API_KEY=... (or V2 credentials)
NIMBUSPOST_WEBHOOK_SECRET=...
```

## Step 4: Add GitHub secrets for deployment

In GitHub repo -> Settings -> Secrets and variables -> Actions, add:

- `AZURE_WEBAPP_NAME`: your Azure Web App name
- `AZURE_WEBAPP_PUBLISH_PROFILE`: publish profile XML from Azure

How to get publish profile:

1. Azure Web App -> Overview
2. Click `Get publish profile`
3. Open downloaded file and copy full XML
4. Paste XML as `AZURE_WEBAPP_PUBLISH_PROFILE`

## Step 5: Deploy backend from GitHub Actions

Deployment starts on push to `main` when backend files change, or manually:

1. Open Actions tab
2. Run workflow `Deploy Backend to Azure App Service`
3. Wait for green status

## Step 6: Verify backend is live

Open in browser:

```text
https://<your-app-name>.azurewebsites.net/health
https://<your-app-name>.azurewebsites.net/api/products
```

Expected:

- `/health` returns `OK`
- `/api/products` returns JSON with `items` and `pagination`

## Step 7: Point the web client to Azure backend

Set in client env:

```text
VITE_API_BASE_URL=https://<your-app-name>.azurewebsites.net/api
```

Build and test locally:

```bash
cd client
npm install
npm run build
npm run preview
```

## Manual steps I cannot do from this workspace

These must be done by you in cloud dashboards:

1. Atlas user + network access creation
2. Azure App Service creation
3. Azure app settings entry
4. GitHub Actions secrets entry (`AZURE_WEBAPP_NAME`, `AZURE_WEBAPP_PUBLISH_PROFILE`)

Once you finish those, I can handle the rest: trigger deploy checks, verify endpoints, wire client base URL, and finalize launch QA.
