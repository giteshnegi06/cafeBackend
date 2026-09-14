/**
 * Vercel serverless entry point for the API.
 *
 * vercel.json routes every /api/* request here. The Express app is built once
 * at module scope so warm invocations reuse it (and its Neon pool), and the
 * original URL is preserved, so the router mounts under /api exactly as it
 * does in the Vite dev plugin and server/standalone.ts.
 */

import express from 'express';
import { apiRouter } from '../server/api.js';

const app = express();

// Body parsing — must be registered before the router
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use('/api', apiRouter);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]:', err);
  res.status(500).json({ error: err?.message || 'Internal Server Error' });
});

export default app;
