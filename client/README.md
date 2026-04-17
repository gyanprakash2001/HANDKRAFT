# HANDKRAFT Web Storefront (Week 2)

This Vite + React app provides the HANDKRAFT web marketplace experience:

- Product feed with search, category filters, and sorting.
- Product details page with image/video gallery.
- API integration to backend `GET /api/products` and `GET /api/products/:id`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure backend API URL (optional).

By default the app uses `http://localhost:5000/api`.

Create `.env` in this folder if your backend runs elsewhere:

```bash
VITE_API_BASE_URL=https://your-backend-domain/api
```

For Azure App Service backend, use:

```bash
VITE_API_BASE_URL=https://your-backend-app-name.azurewebsites.net/api
```

3. Run dev server:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

## Quality Checks

```bash
npm run lint
npm run build
```
