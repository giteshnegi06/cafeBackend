# 7 Days Cafe — Backend

The Express API, split out so it can be deployed as its own project, separate
from the frontend (`../`).

## Local dev

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npm run dev
```

Runs on `http://localhost:3001`. API docs at `/api/docs`.

Point the frontend at it by setting `VITE_API_URL=http://localhost:3001/api`
in the frontend's `.env` (already the default — see `../.env.example`).

## Deploying as its own Vercel project

1. In Vercel, **Add New → Project**, import this same repo.
2. Set **Root Directory** to `backend`.
3. Framework preset: Other. Vercel will use `backend/vercel.json`, which
   builds `api/index.ts` as a serverless function and routes everything to it.
4. Add the environment variables from `.env.example` (`DATABASE_URL`,
   `PUSHER_*`, `SMTP_*`, `APP_BASE_URL`) in the project's Settings →
   Environment Variables.
5. Deploy. Your API will be live at `https://<project>.vercel.app/api/...`.
6. In the **frontend** Vercel project, set `VITE_API_URL` to
   `https://<project>.vercel.app/api`.

## Deploying elsewhere (Docker / Railway / Render / a VPS)

`npm run server` (or `node --import tsx server/standalone.ts` after
`npm install`) starts a long-running process on `PORT` (default 3001). No
build step is required — it runs the TypeScript directly via `tsx`.
