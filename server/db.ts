/**
 * Database layer — uses @neondatabase/serverless Pool with HTTP transport.
 * Works identically in both local dev and Vercel production.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { fetch, Agent, setGlobalDispatcher } from 'undici';
import dotenv from 'dotenv';
import dns from 'dns';

// Load .env in development
if (process.env.VERCEL !== '1') {
  dotenv.config();
}

// Some Windows/local networks advertise IPv6 routes to Neon's endpoints that
// are actually unreachable, so Node's happy-eyeballs connection attempt
// stalls on the IPv6 address for the full connect timeout before ever
// trying IPv4 (which works fine). Prefer IPv4 to skip that stall. This is a
// local-dev-only workaround — Vercel's own network doesn't have this problem,
// and touching the global dispatcher there is an unnecessary crash risk.
if (process.env.VERCEL !== '1') {
  dns.setDefaultResultOrder('ipv4first');
  setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 300 } }));
}

// Use HTTP/fetch transport everywhere (works in Node.js via undici)
neonConfig.poolQueryViaFetch = true;
neonConfig.fetchFunction = fetch as any;

console.log('[DB] Using HTTP transport with undici fetch polyfill');

const CONNECTION_STRING = process.env.DATABASE_URL;

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    if (!CONNECTION_STRING) {
      throw new Error('DATABASE_URL not set');
    }
    console.log('[DB] Creating connection pool...');
    _pool = new Pool({ connectionString: CONNECTION_STRING });
    console.log('[DB] Pool created successfully');
  }
  return _pool;
}

export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<{ rows: T[] }> {
  try {
    const pool = getPool();
    const result = await pool.query<T>(text, params);
    return { rows: result.rows };
  } catch (err: any) {
    console.error('[DB Query Error]', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      query: text.substring(0, 100),
    });
    throw err;
  }
}
