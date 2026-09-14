/**
 * Standalone Express server for running the API outside of Vercel.
 *
 * Usage:
 *   npm run server            — API on port 3001
 *   PORT=3001 npm run server  — custom port
 *
 * This is the backend's own deployable entry point for Docker/VPS/Railway/
 * Render-style hosts. On Vercel, api/index.ts is used instead. Point the
 * frontend at this server by setting VITE_API_URL (e.g.
 * http://localhost:3001/api, or https://your-backend.vercel.app/api).
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { apiRouter } from './api.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = express();

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — allow the separately-deployed frontend to call this API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// API routes
app.use('/api', apiRouter);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({ error: err?.message || 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀  API server running at http://localhost:${PORT}`);
  console.log(`   API:    http://localhost:${PORT}/api`);
  console.log(`   Docs:   http://localhost:${PORT}/api/docs\n`);
});
