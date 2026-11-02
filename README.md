# Reka AI
Free AI video + image generator (text→video, text→image, image→video), Google login, 100 credits / 4h, no watermark.

## Setup
1. `npm install`
2. Copy `.env.example` → `.env`, fill values
3. Google Cloud Console → Credentials → OAuth Client ID (Web). Add your site URL under Authorized JavaScript origins.
4. Edit `callProvider` / `pollProvider` in `server.js` to match your AI provider's API docs.
5. `npm start` → http://localhost:3000

## Deploy
- Backend (server.js): Render / Railway / VPS. API key lives only in env vars.
- GitHub Pages can host `public/` only; then set `window.REKA_API = 'https://your-backend'` in index.html before script.js, and enable CORS in server.js.
