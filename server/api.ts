import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import { query } from './db.js';
import { swaggerDocument } from './swagger.js';
import { notifyResourceChanged } from './realtime.js';
import { hashPassword, verifyPassword, generateResetToken, hashResetToken } from './auth.js';
import { isMailConfigured, sendPasswordResetEmail } from './mailer.js';
import { requireAuth } from './authMiddleware.js';

export const apiRouter = express.Router();
apiRouter.use(express.json());

// Everything registered on protectedRouter below (menu/table/order
// management, admin_users, revenue, etc.) requires a staff JWT. The
// requireAuth+protectedRouter middleware is mounted at the BOTTOM of this
// file, after every public apiRouter route — Express walks a router's stack
// in registration order, so requireAuth must not run until the public routes
// (health, /cafe, /auth/login, /orders, /menu, /categories, /service-requests)
// have already had a chance to match. Mounting it here at the top would make
// requireAuth intercept and 401 every request, public ones included.
const protectedRouter = express.Router();

// Swagger API Documentation UI & JSON endpoint
//
// swagger-ui-express's default setup serves its JS/CSS bundle from the
// swagger-ui-dist package on disk. That works locally, but on Vercel's
// serverless functions those static assets aren't included in the bundle,
// so every request under /docs/* silently falls back to the same index HTML
// (200 OK, wrong content) instead of the actual JS — which the browser then
// fails to parse. Loading the bundle from a CDN instead sidesteps the
// missing-static-files problem entirely.
apiRouter.get('/docs-json', (req: Request, res: Response) => {
  res.json(swaggerDocument);
});
apiRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    swaggerUrl: '/api/docs-json',
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-standalone-preset.min.js',
    ],
  })
);

// Health check endpoint for debugging deployment issues
apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const hasDb = !!process.env.DATABASE_URL;
    const dbPreview = process.env.DATABASE_URL ? 
      process.env.DATABASE_URL.substring(0, 30) + '...' : 'NOT SET';
    
    // Try a simple query
    let dbWorks = false;
    let dbError = null;
    try {
      await query('SELECT 1 as test');
      dbWorks = true;
    } catch (e: any) {
      dbError = e.message;
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL,
        DATABASE_URL_SET: hasDb,
        DATABASE_URL_PREVIEW: dbPreview,
      },
      database: {
        works: dbWorks,
        error: dbError,
      }
    });
  } catch (err: any) {
    res.status(500).json({ 
      status: 'error', 
      error: err.message,
      stack: err.stack 
    });
  }
});

// Helper to map DB cafe to CafeInfo
function mapCafe(row: any) {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline || '',
    logo: row.logo_url || '',
    address: row.address || '',
    phone: row.phone || '',
    currency: row.currency || '₹',
    taxPercent: Number(row.tax_percent || 0),
    serviceChargePercent: Number(row.service_charge_percent || 0),
    isAcceptingOrders: row.is_accepting_orders ?? true,
    upiId: row.upi_id || '',
  };
}

// Helper to map DB table to TableItem
function mapTable(row: any) {
  return {
    id: row.id,
    number: row.number,
    code: row.code,
    capacity: Number(row.capacity),
    status: row.status,
    activeOrderId: row.active_order_id || undefined,
  };
}

// Helper to map DB service_requests row
function mapServiceRequest(row: any) {
  return {
    id: row.id,
    tableId: row.table_id,
    tableNumber: row.table_number,
    type: row.request_type,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null,
  };
}

// Helper to map DB category
function mapCategory(row: any) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || 'Utensils',
    displayOrder: Number(row.display_order || 0),
  };
}

// Helper to map DB admin_users row — password_hash never leaves the server.
function mapStaff(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

// Helper to map DB menu item
function mapMenuItem(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    categoryId: row.category_id,
    vegType: row.veg_type,
    image: row.image_url || '',
    isAvailable: row.is_available,
    preparationTimeMin: row.preparation_time_min ? Number(row.preparation_time_min) : undefined,
    customizationGroups: row.customization_groups || [],
  };
}

// --- CAFE INFO ---
// Public: the customer menu view (/menu/:cafeId/:tableId) reads this to show
// the cafe's name/branding/tax rates before any login exists.
apiRouter.get('/cafe', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    console.log('[GET /cafe] Fetching cafe info for', cafeId);
    const result = await query('SELECT * FROM cafes WHERE id = $1', [cafeId]);
    if (result.rows.length === 0) {
      console.warn('[GET /cafe] No cafe found for id', cafeId);
      return res.status(404).json({ error: 'Cafe not found' });
    }
    const cafe = mapCafe(result.rows[0]);
    console.log('[GET /cafe] Success, cafe id:', cafe.id);
    res.json(cafe);
  } catch (err: any) {
    console.error('[GET /cafe] Error:', err);
    res.status(500).json({
      error: err.message,
      detail: err.detail,
      code: err.code,
      hint: err.hint
    });
  }
});

// Protected: cafe settings can only be changed by that cafe's own staff, and
// always for the cafe their token belongs to — a client-supplied id is
// never trusted here.
protectedRouter.put('/cafe', async (req: Request, res: Response) => {
  try {
    const c = req.body;
    const cafeId = req.cafeId!;
    const result = await query(
      `UPDATE cafes SET
        name = $1, tagline = $2, logo_url = $3, address = $4, phone = $5,
        currency = $6, tax_percent = $7, service_charge_percent = $8,
        is_accepting_orders = $9, upi_id = $10
       WHERE id = $11
       RETURNING *`,
      [
        c.name,
        c.tagline,
        c.logo,
        c.address,
        c.phone,
        c.currency || '₹',
        c.taxPercent || 0,
        c.serviceChargePercent || 0,
        c.isAcceptingOrders ?? true,
        c.upiId || '',
        cafeId,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cafe not found' });
    notifyResourceChanged(cafeId, 'cafe');
    res.json(mapCafe(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- TABLES ---
// Public: the QR flow validates/looks up a table by fetching this cafe's
// table list. Table CRUD itself (create/edit/delete) is staff-only, below.
apiRouter.get('/tables', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    const result = await query('SELECT * FROM tables WHERE cafe_id = $1 ORDER BY number ASC', [cafeId]);
    res.json(result.rows.map(mapTable));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.post('/tables', async (req: Request, res: Response) => {
  try {
    console.log('[POST /tables] Creating table with body:', JSON.stringify(req.body));
    const t = req.body;
    if (!t || !t.number) {
      return res.status(400).json({ error: 'Missing required field: number' });
    }

    const cafeId = req.cafeId!;
    console.log('[POST /tables] Using cafe_id:', cafeId);

    const cleanNum = t.number.replace(/[^0-9]/g, '') || String(Date.now()).slice(-2);
    const id = `table-${cleanNum}`;
    const code = `table-${cleanNum}`;

    const result = await query(
      `INSERT INTO tables (id, cafe_id, number, code, capacity, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, cafeId, t.number, code, t.capacity || 4, t.status || 'available']
    );

    console.log('[POST /tables] Success, created table id:', id);
    notifyResourceChanged(cafeId, 'tables');
    res.json(mapTable(result.rows[0]));
  } catch (err: any) {
    console.error('[POST /tables] Error:', err);
    res.status(500).json({
      error: err.message,
      detail: err.detail,
      code: err.code,
      hint: err.hint
    });
  }
});

protectedRouter.patch('/tables/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const updates = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.capacity !== undefined) {
      fields.push(`capacity = $${idx++}`);
      values.push(updates.capacity);
    }
    if (updates.number !== undefined) {
      fields.push(`number = $${idx++}`);
      values.push(updates.number);
    }
    if (updates.activeOrderId !== undefined) {
      fields.push(`active_order_id = $${idx++}`);
      values.push(updates.activeOrderId || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, cafeId);
    const result = await query(
      `UPDATE tables SET ${fields.join(', ')} WHERE id = $${idx} AND cafe_id = $${idx + 1} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Table not found' });
    notifyResourceChanged(cafeId, 'tables');
    res.json(mapTable(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.delete('/tables/:id', async (req: Request, res: Response) => {
  try {
    const cafeId = req.cafeId!;
    const result = await query('DELETE FROM tables WHERE id = $1 AND cafe_id = $2 RETURNING id', [
      req.params.id,
      cafeId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Table not found' });
    notifyResourceChanged(cafeId, 'tables');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- STAFF ACCOUNTS (admin_users) ---
// Kept intentionally simple: the cafe admin adds a name/email/password/role
// here, and the resulting account can sign in at the staff portal. Every
// account belongs to the single cafe row (same pattern as tables/menu).
protectedRouter.get('/admin-users', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM admin_users WHERE cafe_id = $1 ORDER BY created_at DESC', [
      req.cafeId,
    ]);
    res.json(result.rows.map(mapStaff));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.post('/admin-users', async (req: Request, res: Response) => {
  try {
    const s = req.body;
    if (!s || !s.name || !s.email || !s.password) {
      return res.status(400).json({ error: 'Missing required field: name, email, password' });
    }
    const role = s.role === 'admin' ? 'admin' : s.role === 'staff' ? 'staff' : 'kitchen';
    const cafeId = req.cafeId!;
    const id = `staff-${Date.now()}`;
    const passwordHash = hashPassword(s.password);

    const result = await query(
      `INSERT INTO admin_users (id, cafe_id, name, email, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, cafeId, s.name, s.email.toLowerCase().trim(), role, passwordHash]
    );

    res.json(mapStaff(result.rows[0]));
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.delete('/admin-users/:id', async (req: Request, res: Response) => {
  try {
    const result = await query('DELETE FROM admin_users WHERE id = $1 AND cafe_id = $2 RETURNING id', [
      req.params.id,
      req.cafeId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Staff account not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Lets the cafe admin set a new password for a staff account (e.g. they
// forgot it, or it should be rotated) without needing the old one — the
// admin console itself is the trusted party here (requireAuth already
// confirms the caller is signed in as staff of this same cafe).
protectedRouter.patch('/admin-users/:id/password', async (req: Request, res: Response) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const passwordHash = hashPassword(password);
    const result = await query(
      'UPDATE admin_users SET password_hash = $1 WHERE id = $2 AND cafe_id = $3 RETURNING *',
      [passwordHash, req.params.id, req.cafeId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Staff account not found' });
    res.json(mapStaff(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Verifies a staff login against admin_users. This is the only way into the
// staff portal — there is no built-in or demo account, so every sign-in must
// match a real account row and its password.
// Sign-in and password flows answer expected failures (wrong password, bad
// token, mail not set up) with 200 + { ok: false, error } instead of a 4xx.
// The browser logs every non-2xx fetch as a console error, so a mistyped
// password would otherwise litter the console; the client checks `ok`.
function authFail(res: Response, payload: { error: string }) {
  return res.status(200).json({ ok: false, ...payload });
}

// admin_users.email is only unique per cafe now (see migrations/005), so a
// login lookup by email alone would be ambiguous across cafes. The frontend
// already knows which cafe it's on (the staff portal is reached via that
// cafe's own URL), so it sends cafeId along with the credentials.
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { cafeId, email, password } = req.body || {};
    if (!cafeId || !email || !password) {
      return authFail(res, { error: 'Missing cafeId, email or password' });
    }
    const result = await query('SELECT * FROM admin_users WHERE cafe_id = $1 AND email = $2', [
      cafeId,
      String(email).toLowerCase().trim(),
    ]);
    const row = result.rows[0];
    if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
      return authFail(res, { error: 'Invalid email or password' });
    }
    const token = jwt.sign({ sub: row.id, cafeId: row.cafe_id, role: row.role }, process.env.JWT_SECRET!, {
      expiresIn: '30d',
    });
    res.json({ token, user: mapStaff(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Lets a signed-in person change their own password. Unlike the admin-side
// reset above, this insists on the current password, so a stolen/borrowed
// token alone can't silently take over the account. The account is looked
// up by the token's own subject + cafe rather than a client-supplied email,
// so this can never be used to touch another account.
protectedRouter.post('/auth/change-password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return authFail(res, { error: 'Missing current password or new password' });
    }
    if (String(newPassword).length < 6) {
      return authFail(res, { error: 'New password must be at least 6 characters' });
    }
    const result = await query('SELECT * FROM admin_users WHERE id = $1 AND cafe_id = $2', [
      req.userId,
      req.cafeId,
    ]);
    const row = result.rows[0];
    if (!row || !row.password_hash || !verifyPassword(currentPassword, row.password_hash)) {
      return authFail(res, { error: 'Current password is incorrect' });
    }
    const updated = await query(
      'UPDATE admin_users SET password_hash = $1 WHERE id = $2 AND cafe_id = $3 RETURNING *',
      [hashPassword(newPassword), row.id, req.cafeId]
    );
    res.json(mapStaff(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- FORGOT PASSWORD (email link) ---
// Step 1: the person enters their email on the login page. If it matches an
// account, a single-use link is emailed to it. The response is the same
// either way so the form can't be used to discover which emails have accounts.
const RESET_TOKEN_TTL_MINUTES = 30;

function appBaseUrl(req: Request): string {
  // APP_BASE_URL wins (set it on Vercel to the public site URL). Otherwise
  // fall back to wherever this request came from — right for local dev.
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  return `${proto}://${host}`;
}

apiRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  try {
    const { cafeId, email } = req.body || {};
    if (!cafeId || !email) return authFail(res, { error: 'Missing cafeId or email' });
    if (!isMailConfigured()) {
      return authFail(res, {
        error: 'Password reset email is not set up for this cafe. Ask whoever hosts the app to configure SMTP_USER / SMTP_PASS.',
      });
    }

    const result = await query('SELECT * FROM admin_users WHERE cafe_id = $1 AND email = $2', [
      cafeId,
      String(email).toLowerCase().trim(),
    ]);
    const row = result.rows[0];
    const genericOk = { ok: true, message: 'If that email has a staff account, a reset link has been sent to it.' };
    if (!row) return res.json(genericOk);

    const token = generateResetToken();
    await query(
      `INSERT INTO password_resets (token_hash, cafe_id, user_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
      [hashResetToken(token), row.cafe_id, row.id, String(RESET_TOKEN_TTL_MINUTES)]
    );

    const cafe = await query('SELECT name FROM cafes WHERE id = $1', [row.cafe_id]);
    const cafeName = cafe.rows[0]?.name || 'Cafe';
    const resetUrl = `${appBaseUrl(req)}/reset-password?token=${token}`;

    try {
      await sendPasswordResetEmail({
        to: row.email,
        name: row.name || 'there',
        cafeName,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      });
    } catch (mailErr: any) {
      console.error('[POST /auth/forgot-password] Email send failed:', mailErr.message);
      return authFail(res, { error: 'Could not send the reset email right now. Please try again in a minute.' });
    }
    res.json(genericOk);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2: the emailed link opens /reset-password?token=... which posts the
// token with the new password. The token must exist, be unused and unexpired.
apiRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return authFail(res, { error: 'Missing token or new password' });
    }
    if (String(newPassword).length < 6) {
      return authFail(res, { error: 'New password must be at least 6 characters' });
    }
    const found = await query(
      `SELECT r.token_hash, r.cafe_id, r.user_id, r.expires_at, r.used_at, u.email
       FROM password_resets r JOIN admin_users u ON u.id = r.user_id AND u.cafe_id = r.cafe_id
       WHERE r.token_hash = $1`,
      [hashResetToken(String(token))]
    );
    const row = found.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return authFail(res, {
        error: 'This reset link is invalid or has expired. Request a new one from the login page.',
      });
    }
    await query('UPDATE admin_users SET password_hash = $1 WHERE id = $2 AND cafe_id = $3', [
      hashPassword(newPassword),
      row.user_id,
      row.cafe_id,
    ]);
    await query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
    res.json({ ok: true, email: row.email });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- SERVICE REQUESTS ("Need Water" / "Call Server") ---
// Raised by a customer from the order-tracking screen; staff see them on the
// Kitchen display and Admin dashboard until they mark them done.
const SERVICE_REQUEST_TYPES = new Set(['water', 'server']);

// Public: polled by both the customer's own order-tracking screen and the
// staff Kitchen display, neither of which is guaranteed to be logged in —
// this was fully public with no auth at all before multi-tenancy, so this
// keeps that working, just now properly scoped by cafe_id via ?cafeId=
// instead of implicitly by "whichever cafe is in this database".
apiRouter.get('/service-requests', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    const result = await query(
      `SELECT * FROM service_requests WHERE cafe_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
      [cafeId]
    );
    res.json(result.rows.map(mapServiceRequest));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: raised by a customer from the order-tracking screen, no login.
apiRouter.post('/service-requests', async (req: Request, res: Response) => {
  try {
    const { cafeId, tableId, tableNumber, type } = req.body || {};
    if (!cafeId || !tableId || !tableNumber || !SERVICE_REQUEST_TYPES.has(type)) {
      return res.status(400).json({ error: 'cafeId, tableId, tableNumber and a valid type are required' });
    }

    // A table tapping the same button twice shouldn't page the staff twice.
    // While one request of that kind is still open, hand it back unchanged.
    const existing = await query(
      `SELECT * FROM service_requests
       WHERE cafe_id = $1 AND table_id = $2 AND request_type = $3 AND status = 'pending'
       LIMIT 1`,
      [cafeId, tableId, type]
    );
    if (existing.rows.length > 0) {
      return res.json({ ...mapServiceRequest(existing.rows[0]), duplicate: true });
    }

    const id = `sr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await query(
      `INSERT INTO service_requests (id, cafe_id, table_id, table_number, request_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, cafeId, tableId, tableNumber, type]
    );
    notifyResourceChanged(cafeId, 'service_requests');
    res.status(201).json(mapServiceRequest(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.patch('/service-requests/:id/resolve', async (req: Request, res: Response) => {
  try {
    const cafeId = req.cafeId!;
    const result = await query(
      `UPDATE service_requests SET status = 'resolved', resolved_at = now()
       WHERE id = $1 AND cafe_id = $2 AND status = 'pending'
       RETURNING *`,
      [req.params.id, cafeId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already resolved' });
    }
    notifyResourceChanged(cafeId, 'service_requests');
    res.json(mapServiceRequest(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- CATEGORIES ---
// Public: part of the customer menu view.
apiRouter.get('/categories', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    const result = await query(
      'SELECT * FROM categories WHERE cafe_id = $1 ORDER BY display_order ASC, name ASC',
      [cafeId]
    );
    res.json(result.rows.map(mapCategory));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.post('/categories', async (req: Request, res: Response) => {
  try {
    console.log('[POST /categories] Creating category with body:', JSON.stringify(req.body));
    const { name, icon } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }

    const cafeId = req.cafeId!;
    console.log('[POST /categories] Using cafe_id:', cafeId);

    const id = `cat-${Date.now()}`;
    const countRes = await query('SELECT count(*) FROM categories WHERE cafe_id = $1', [cafeId]);
    const displayOrder = parseInt(countRes.rows[0].count, 10) + 1;

    const result = await query(
      `INSERT INTO categories (id, cafe_id, name, icon, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, cafeId, name, icon || 'Utensils', displayOrder]
    );

    console.log('[POST /categories] Success, created category id:', id);
    notifyResourceChanged(cafeId, 'categories');
    res.json(mapCategory(result.rows[0]));
  } catch (err: any) {
    console.error('[POST /categories] Error:', err);
    res.status(500).json({
      error: err.message,
      detail: err.detail,
      code: err.code,
      hint: err.hint
    });
  }
});

protectedRouter.put('/categories/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const { name, icon } = req.body;
    const result = await query(
      'UPDATE categories SET name = $1, icon = COALESCE($2, icon) WHERE id = $3 AND cafe_id = $4 RETURNING *',
      [name, icon, id, cafeId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    notifyResourceChanged(cafeId, 'categories');
    res.json(mapCategory(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.delete('/categories/:id', async (req: Request, res: Response) => {
  try {
    const cafeId = req.cafeId!;
    const result = await query('DELETE FROM categories WHERE id = $1 AND cafe_id = $2 RETURNING id', [
      req.params.id,
      cafeId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    notifyResourceChanged(cafeId, 'categories');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- MENU ITEMS ---
// Public: part of the customer menu view.
apiRouter.get('/menu', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    const result = await query('SELECT * FROM menu_items WHERE cafe_id = $1 ORDER BY name ASC', [cafeId]);
    res.json(result.rows.map(mapMenuItem));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.post('/menu', async (req: Request, res: Response) => {
  try {
    console.log('[POST /menu] Creating menu item with body:', JSON.stringify(req.body));
    const item = req.body;
    if (!item || !item.name || !item.price || !item.categoryId || !item.vegType) {
      return res.status(400).json({
        error: 'Missing required fields: name, price, categoryId, vegType'
      });
    }

    const cafeId = req.cafeId!;
    console.log('[POST /menu] Using cafe_id:', cafeId);
    
    const id = `item-${Date.now()}`;
    const result = await query(
      `INSERT INTO menu_items (id, cafe_id, category_id, name, description, price, veg_type, image_url, is_available, preparation_time_min, customization_groups)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        cafeId,
        item.categoryId,
        item.name,
        item.description || '',
        item.price,
        item.vegType,
        item.image || '',
        item.isAvailable ?? true,
        item.preparationTimeMin || 15,
        JSON.stringify(item.customizationGroups || []),
      ]
    );
    
    console.log('[POST /menu] Success, created menu item id:', id);
    notifyResourceChanged(cafeId, 'menu');
    res.json(mapMenuItem(result.rows[0]));
  } catch (err: any) {
    console.error('[POST /menu] Error:', err);
    res.status(500).json({
      error: err.message,
      detail: err.detail,
      code: err.code,
      hint: err.hint
    });
  }
});

protectedRouter.put('/menu/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const item = req.body;
    const result = await query(
      `UPDATE menu_items SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        category_id = COALESCE($4, category_id),
        veg_type = COALESCE($5, veg_type),
        image_url = COALESCE($6, image_url),
        is_available = COALESCE($7, is_available),
        preparation_time_min = COALESCE($8, preparation_time_min),
        customization_groups = COALESCE($9, customization_groups)
       WHERE id = $10 AND cafe_id = $11
       RETURNING *`,
      [
        item.name,
        item.description,
        item.price,
        item.categoryId,
        item.vegType,
        item.image,
        item.isAvailable,
        item.preparationTimeMin,
        item.customizationGroups ? JSON.stringify(item.customizationGroups) : null,
        id,
        cafeId,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    notifyResourceChanged(cafeId, 'menu');
    res.json(mapMenuItem(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.patch('/menu/:id/availability', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const result = await query(
      'UPDATE menu_items SET is_available = NOT is_available WHERE id = $1 AND cafe_id = $2 RETURNING *',
      [id, cafeId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    notifyResourceChanged(cafeId, 'menu');
    res.json({ isAvailable: result.rows[0].is_available });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.delete('/menu/:id', async (req: Request, res: Response) => {
  try {
    const cafeId = req.cafeId!;
    const result = await query('DELETE FROM menu_items WHERE id = $1 AND cafe_id = $2 RETURNING id', [
      req.params.id,
      cafeId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    notifyResourceChanged(cafeId, 'menu');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ORDERS ---

// Kitchen backlog rule: while more than KITCHEN_BUSY_THRESHOLD orders are still
// waiting to be cooked, every further order (the 6th onwards) queues behind that
// backlog, so it is quoted KITCHEN_BUSY_EXTRA_MIN minutes on top of its own
// cooking time. Mirrors the same rule in src/services/storage.ts.
const KITCHEN_BUSY_THRESHOLD = 5;
const KITCHEN_BUSY_EXTRA_MIN = 8;

// How recently an order must have been stored for a POST carrying its id to
// count as a re-send of that same order rather than a client reusing an id that
// is already taken. Comfortably wider than the client's retry window.
const ORDER_RESEND_WINDOW_MS = 10 * 60 * 1000;

// Order numbers run ORD-1001 through ORD-9009 and then start over at 1001.
// Mirrored in src/services/storage.ts, which proposes the id.
const ORDER_ID_MIN = 1001;
const ORDER_ID_MAX = 9009;
const ORDER_ID_RANGE = ORDER_ID_MAX - ORDER_ID_MIN + 1;

const nextOrderNumber = (n: number): number => (n >= ORDER_ID_MAX ? ORDER_ID_MIN : n + 1);

// A round's own cooking time: the slowest dish, plus a minute per extra dish.
function computeRoundPrepTime(items: any[]): number {
  if (!items || items.length === 0) return 15;
  const maxPrep = items.reduce(
    (max: number, item: any) => Math.max(max, Number(item?.preparationTimeMin) || 15),
    0
  );
  return maxPrep + (items.length - 1);
}

// Orders the kitchen still has to cook — 'received' (not accepted yet) and
// 'preparing' (on the pass). 'ready' is already cooked, so it holds nobody up.
async function getKitchenQueueLoad(cafeId: string): Promise<number> {
  const res = await query(
    `SELECT count(*) FROM orders WHERE cafe_id = $1 AND status IN ('received', 'preparing')`,
    [cafeId]
  );
  return Number(res.rows[0].count) || 0;
}

// Prep time for a round about to be created: whatever the client already
// worked out, else this round's cooking time plus the backlog surcharge when
// the kitchen is over the threshold. Call BEFORE inserting the new order so it
// does not count itself.
async function resolveNewRoundPrepTime(orderData: any, cafeId: string): Promise<number> {
  if (orderData?.estimatedPrepTimeMin) return Number(orderData.estimatedPrepTimeMin);
  const base = computeRoundPrepTime(orderData?.items);
  const queueLoad = await getKitchenQueueLoad(cafeId);
  return queueLoad >= KITCHEN_BUSY_THRESHOLD ? base + KITCHEN_BUSY_EXTRA_MIN : base;
}

// The order number a given id carries, or null if it isn't one of ours.
function orderIdNumber(id: string | undefined | null): number | null {
  const match = /^ORD-(\d+)$/.exec(id || '');
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= ORDER_ID_MIN && n <= ORDER_ID_MAX ? n : null;
}

// Hands out the next order id in the 1001-9009 cycle. Numbers still held by a
// stored order are skipped rather than reused: the id is the primary key, so
// after a wrap the ones that haven't been cleared out yet are not free to
// hand out again.
//
// NOTE: orders.id is the table's global primary key, and this table is now
// shared across every cafe. Scoping the "taken" check by cafe_id keeps the
// 1001-9009 cycle per-cafe (matching how the client's own local counter
// works), but that means two different cafes' orders can legitimately want
// the same ORD-xxxx id at the same time, which the shared PK cannot hold
// simultaneously — a real residual collision risk this migration doesn't
// resolve. Flagging it rather than silently shipping it.
async function allocateOrderId(cafeId: string): Promise<string> {
  const takenRes = await query(
    `SELECT substring(id from 5)::int AS n FROM orders WHERE cafe_id = $1 AND id ~ '^ORD-[0-9]+$'`,
    [cafeId]
  );
  const taken = new Set<number>(takenRes.rows.map((r: any) => Number(r.n)));

  // Continue from the most recently placed order rather than the highest
  // number, which would sit at the top of the range forever once it wraps.
  const lastRes = await query(
    `SELECT id FROM orders WHERE cafe_id = $1 AND id ~ '^ORD-[0-9]+$' ORDER BY created_at DESC LIMIT 1`,
    [cafeId]
  );
  const lastNumber = orderIdNumber(lastRes.rows[0]?.id);

  let candidate = lastNumber === null ? ORDER_ID_MIN : nextOrderNumber(lastNumber);
  for (let step = 0; step < ORDER_ID_RANGE && taken.has(candidate); step++) {
    candidate = nextOrderNumber(candidate);
  }

  if (taken.has(candidate)) {
    throw new Error(
      `All order numbers ${ORDER_ID_MIN}-${ORDER_ID_MAX} are in use — clear out old orders before placing more.`
    );
  }
  return `ORD-${candidate}`;
}

// cafeId is always the first bound param ($1); extraWhere/extraParams add
// further conditions starting at $2 (e.g. 'AND id = $2').
async function fetchFullOrders(cafeId: string, extraWhere = '', extraParams: any[] = []) {
  const ordersQuery = `
    SELECT * FROM orders
    WHERE cafe_id = $1
    ${extraWhere}
    ORDER BY created_at DESC
  `;
  const ordersRes = await query(ordersQuery, [cafeId, ...extraParams]);
  if (ordersRes.rows.length === 0) return [];

  const orderIds = ordersRes.rows.map((o) => o.id);

  // Fetch all rounds for these orders
  const roundsRes = await query(
    `SELECT * FROM order_rounds WHERE order_id = ANY($1::text[]) AND cafe_id = $2 ORDER BY order_id, round_number ASC`,
    [orderIds, cafeId]
  );

  const roundIds = roundsRes.rows.map((r) => r.id);

  // Fetch all items for these rounds
  let itemsRes: any = { rows: [] };
  if (roundIds.length > 0) {
    itemsRes = await query(
      `SELECT * FROM order_items WHERE order_round_id = ANY($1::uuid[]) AND cafe_id = $2`,
      [roundIds, cafeId]
    );
  }

  // Group items by round_id
  const itemsByRound = new Map<string, any[]>();
  for (const item of itemsRes.rows) {
    const arr = itemsByRound.get(item.order_round_id) || [];
    arr.push({
      itemId: item.id,
      menuItemId: item.menu_item_id,
      name: item.name,
      price: Number(item.price),
      vegType: item.veg_type,
      image: '',
      quantity: Number(item.quantity),
      selectedCustomizations: item.selected_customizations || [],
      specialInstructions: item.special_instructions || undefined,
      itemTotal: Number(item.item_total),
      preparationTimeMin: item.preparation_time_min || undefined,
    });
    itemsByRound.set(item.order_round_id, arr);
  }

  // Group rounds by order_id
  const roundsByOrder = new Map<string, any[]>();
  for (const round of roundsRes.rows) {
    const arr = roundsByOrder.get(round.order_id) || [];
    const rItems = itemsByRound.get(round.id) || [];
    arr.push({
      roundNumber: Number(round.round_number),
      items: rItems,
      placedAt: new Date(round.placed_at).getTime(),
      estimatedPrepTimeMin: Number(round.estimated_prep_time_min || 15),
      preparingStartedAt: round.preparing_started_at ? new Date(round.preparing_started_at).getTime() : undefined,
      readyAt: round.ready_at ? new Date(round.ready_at).getTime() : undefined,
      status: round.status,
    });
    roundsByOrder.set(round.order_id, arr);
  }

  // Assemble orders
  return ordersRes.rows.map((o) => {
    const rounds = roundsByOrder.get(o.id) || [];
    // Aggregate items from all rounds
    const allItems: any[] = [];
    for (const r of rounds) {
      allItems.push(...r.items);
    }

    const firstRound = rounds[0];
    return {
      id: o.id,
      cafeId: o.cafe_id,
      tableId: o.table_id,
      tableNumber: o.table_number,
      items: allItems,
      subtotal: Number(o.subtotal),
      tax: Number(o.tax),
      serviceCharge: Number(o.service_charge),
      total: Number(o.total),
      status: o.status,
      customerName: o.customer_name || undefined,
      customerPhone: o.customer_phone || undefined,
      specialInstructions: o.special_instructions || undefined,
      paymentMethod: o.payment_method,
      paymentStatus: o.payment_status,
      createdAt: new Date(o.created_at).getTime(),
      updatedAt: new Date(o.updated_at).getTime(),
      preparingStartedAt: firstRound?.preparingStartedAt,
      estimatedPrepTimeMin: firstRound?.estimatedPrepTimeMin || 15,
      readyAt: firstRound?.readyAt,
      orderRounds: Number(o.order_rounds_count || rounds.length || 1),
      isMerged: o.is_merged,
      mergedOrderIds: o.merged_order_ids || [],
      rounds: rounds,
    };
  });
}

// --- REVENUE ---

// Day-by-day takings for one calendar month.
//
// The figures are recomputed from `orders` (the source of truth) on every
// request and then upserted into daily_revenue, so the stored rollup can never
// drift from the orders it summarises — and a caller that would rather read the
// table directly, for an export or a report, always finds it current.
//
// `tz` decides where a day starts. An 11pm order in Asia/Kolkata belongs to
// that day, not to the next one as UTC would have it, so the caller passes its
// own zone and the same boundary is used for both the maths and the stored row.
protectedRouter.get('/revenue/daily', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'month must be formatted YYYY-MM' });
    }
    const timeZone = String(req.query.tz || 'UTC');
    const cafeId = req.cafeId!;

    // Cancelled orders never earned anything, so they are left out of every
    // figure here — matching what the dashboard's other money tiles show.
    let daily;
    try {
      daily = await query(
        `SELECT
           -- Returned as text on purpose. A date column comes back from the
           -- driver as a JS Date at *local* midnight, so formatting it through
           -- toISOString() shifts the label a day west of the actual day.
           to_char((created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS business_date,
           count(*)::int                      AS orders_count,
           sum(subtotal)                      AS subtotal,
           sum(COALESCE(service_charge, 0))   AS service_charge,
           sum(COALESCE(tax, 0))              AS tax,
           sum(subtotal + COALESCE(service_charge, 0)) AS revenue
         FROM orders
         WHERE cafe_id = $1
           AND status <> 'cancelled'
           AND (created_at AT TIME ZONE $2) >= ($3 || '-01')::date
           AND (created_at AT TIME ZONE $2) <  (($3 || '-01')::date + interval '1 month')
         GROUP BY 1
         ORDER BY 1`,
        [cafeId, timeZone, month]
      );
    } catch (e: any) {
      // An unknown zone name is the caller's mistake, not a server fault.
      if (/time zone/i.test(e.message || '')) {
        return res.status(400).json({ error: `Unknown time zone: ${timeZone}` });
      }
      throw e;
    }

    for (const row of daily.rows) {
      await query(
        `INSERT INTO daily_revenue
           (cafe_id, business_date, orders_count, subtotal, service_charge, tax, revenue, time_zone, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (cafe_id, business_date) DO UPDATE SET
           orders_count   = EXCLUDED.orders_count,
           subtotal       = EXCLUDED.subtotal,
           service_charge = EXCLUDED.service_charge,
           tax            = EXCLUDED.tax,
           revenue        = EXCLUDED.revenue,
           time_zone      = EXCLUDED.time_zone,
           updated_at     = now()`,
        [
          cafeId,
          row.business_date,
          row.orders_count,
          row.subtotal,
          row.service_charge,
          row.tax,
          row.revenue,
          timeZone,
        ]
      );
    }

    // A day the cafe recorded takings for and has since had every order
    // deleted would otherwise keep its stale row forever.
    const keptDates = daily.rows.map((r: any) => r.business_date);
    await query(
      `DELETE FROM daily_revenue
       WHERE cafe_id = $1
         AND business_date >= ($2 || '-01')::date
         AND business_date <  (($2 || '-01')::date + interval '1 month')
         AND NOT (business_date = ANY($3::date[]))`,
      [cafeId, month, keptDates]
    );

    const days = daily.rows.map((r: any) => ({
      date: String(r.business_date),
      ordersCount: Number(r.orders_count),
      subtotal: Number(r.subtotal),
      serviceCharge: Number(r.service_charge),
      tax: Number(r.tax),
      revenue: Number(r.revenue),
    }));

    res.json({
      month,
      timeZone,
      days,
      totalRevenue: days.reduce((sum: number, d: any) => sum + d.revenue, 0),
      totalOrders: days.reduce((sum: number, d: any) => sum + d.ordersCount, 0),
    });
  } catch (err: any) {
    console.error('[GET /revenue/daily Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Public: polled by the customer's own order-tracking screen (to see status
// updates on their order) as well as staff dashboards — fully public with no
// auth at all before multi-tenancy, so this keeps that working, just now
// properly scoped by cafe_id via ?cafeId= instead of implicitly by
// "whichever cafe is in this database". Exposes other diners' names/phone
// numbers at the same cafe to anyone who knows its cafeId, same as before
// this migration — not a new regression, just carried forward as-is.
apiRouter.get('/orders', async (req: Request, res: Response) => {
  try {
    const cafeId = String(req.query.cafeId || '');
    if (!cafeId) return res.status(400).json({ error: 'cafeId is required' });
    const orders = await fetchFullOrders(cafeId);
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: this is how a customer places an order from the QR menu, no login.
apiRouter.post('/orders', async (req: Request, res: Response) => {
  try {
    const orderData = req.body;
    console.log('[POST /orders] body keys:', orderData ? Object.keys(orderData) : 'NO BODY');
    console.log('[POST /orders] tableId:', orderData?.tableId, '| items count:', orderData?.items?.length);

    // Body-parse guard: if body is empty the JSON middleware didn't run
    if (!orderData || typeof orderData !== 'object' || !orderData.tableId || !orderData.cafeId) {
      console.error('[POST /orders] Bad or missing body:', orderData);
      return res.status(400).json({ error: 'Missing or invalid request body. Received: ' + JSON.stringify(orderData) });
    }
    const cafeId = String(orderData.cafeId);
    const forceNew = req.query.force === 'true';

    // Idempotency guard. The client POSTs with the id it already assigned
    // locally, and re-POSTs that same order if its first attempt looked like it
    // failed (a slow response, a dropped connection). Without this check the
    // re-send falls through to the open-bill merge rule below and gets recorded as
    // an extra ROUND on the very order it was trying to create — one phantom
    // round per retry. If we already have this id, the write is already done.
    if (orderData.id) {
      const existingById = await query(
        'SELECT id, table_id, total, created_at FROM orders WHERE id = $1 AND cafe_id = $2',
        [orderData.id, cafeId]
      );
      if (existingById.rows.length > 0) {
        const row = existingById.rows[0];
        // Only a genuine re-send short-circuits. The client's order numbers come
        // from a counter in its own localStorage, so a new device — or one whose
        // site data was cleared — restarts at the bottom of the range and asks
        // for ids that
        // older orders already hold. Treating that as a re-send would hand the
        // customer back somebody's finished order instead of taking their new
        // one, so require the marks only a real retry carries: same table, same
        // money, and placed within the retry window rather than hours ago.
        const isResend =
          row.table_id === orderData.tableId &&
          Number(row.total) === (Number(orderData.total) || 0) &&
          Date.now() - new Date(row.created_at).getTime() < ORDER_RESEND_WINDOW_MS;

        if (isResend) {
          console.log('[POST /orders] duplicate re-send of', orderData.id, '— returning stored order');
          const alreadyStored = await fetchFullOrders(cafeId, 'AND id = $2', [orderData.id]);
          return res.json(alreadyStored[0]);
        }

        // Otherwise the client reused an id that is already taken. Drop it and
        // let the DB hand out a fresh one below.
        console.warn('[POST /orders] id', orderData.id, 'already taken — assigning a new id');
        delete orderData.id;
      }
    }

    // Anything that survived the check above still has to be a number from the
    // ORD-1001..ORD-9009 cycle; a client proposing something outside it gets
    // one issued here instead, so the numbering stays inside the range.
    if (orderData.id && orderIdNumber(orderData.id) === null) {
      console.warn('[POST /orders] id', orderData.id, 'is outside the order-number range — assigning a new id');
      delete orderData.id;
    }

    // Ensure table exists in tables DB table to avoid FK constraint failure
    if (orderData.tableId) {
      const tableCheck = await query('SELECT id FROM tables WHERE id = $1 AND cafe_id = $2', [
        orderData.tableId,
        cafeId,
      ]);
      if (tableCheck.rows.length === 0) {
        await query(
          `INSERT INTO tables (id, cafe_id, number, code, capacity, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            orderData.tableId,
            cafeId,
            orderData.tableNumber || `Table ${orderData.tableId.replace(/[^0-9]/g, '')}`,
            orderData.tableId,
            4,
            'available',
          ]
        );
      }
    }

    // Helper function to resolve valid menuItemId that exists in DB
    const getValidMenuItemId = async (rawId?: string): Promise<string | null> => {
      if (!rawId) return null;
      const check = await query('SELECT id FROM menu_items WHERE id = $1 AND cafe_id = $2', [rawId, cafeId]);
      return check.rows.length > 0 ? rawId : null;
    };

    // 1. Join the table's open bill if it has one. A bill stays open from the
    //    first order until an admin settles it with Paid — no time window — so
    //    everything the table orders in between lands on one order id as an
    //    extra round. payment_status is the source of truth (see findOpenBill
    //    on the client): serving the food no longer closes anything.
    if (!forceNew) {
      // The table must still be occupied for its bill to count as open — see
      // findOpenBill on the client. Without that join an order left unpaid on
      // some earlier day stays joinable forever and swallows every future
      // customer at that table. Ordering prefers the bill the table itself
      // points at, falling back to its newest unpaid order.
      const activeRes = await query(
        `SELECT o.id FROM orders o
         JOIN tables t ON t.id = o.table_id
         WHERE o.table_id = $1
           AND o.cafe_id = $2
           AND t.status = 'occupied'
           AND o.status <> 'cancelled'
           AND o.payment_status <> 'paid'
         ORDER BY (o.id = t.active_order_id) DESC, o.created_at DESC
         LIMIT 1`,
        [orderData.tableId, cafeId]
      );

      if (activeRes.rows.length > 0) {
        const existing = activeRes.rows[0];

        // Calculate prep time for new round
        const prepTime = await resolveNewRoundPrepTime(orderData, cafeId);

        // Claim the next round number in the same statement that increments it.
        // Two people ordering for this table at the same moment serialise on
        // this row's lock and each get a distinct number, so they can no
        // longer both read the same count and then collide on uq_order_round
        // (which would fail one of the two orders outright). GREATEST also
        // heals a count that has fallen behind the rounds actually stored,
        // which would otherwise hand out a number that is already taken.
        const bumped = await query(
          `UPDATE orders SET
            order_rounds_count = GREATEST(
              order_rounds_count,
              (SELECT COALESCE(MAX(round_number), 0) FROM order_rounds WHERE order_id = orders.id)
            ) + 1,
            is_merged = true,
            subtotal = subtotal + $2,
            total = total + $3,
            updated_at = now()
           WHERE id = $1 AND cafe_id = $4
           RETURNING order_rounds_count`,
          [existing.id, Number(orderData.subtotal) || 0, Number(orderData.total) || 0, cafeId]
        );
        const newRoundNumber = Number(bumped.rows[0].order_rounds_count);

        // Create new round in DB
        const roundRes = await query(
          `INSERT INTO order_rounds (order_id, cafe_id, round_number, placed_at, estimated_prep_time_min, status)
           VALUES ($1, $2, $3, now(), $4, 'received')
           RETURNING id`,
          [existing.id, cafeId, newRoundNumber, prepTime]
        );
        const roundId = roundRes.rows[0].id;

        // Insert items for this new round
        for (const it of orderData.items || []) {
          const validMenuItemId = await getValidMenuItemId(it.menuItemId);
          await query(
            `INSERT INTO order_items (order_round_id, cafe_id, menu_item_id, name, price, veg_type, quantity, item_total, special_instructions, preparation_time_min, selected_customizations)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              roundId,
              cafeId,
              validMenuItemId,
              it.name,
              it.price,
              it.vegType || 'veg',
              it.quantity,
              it.itemTotal,
              it.specialInstructions || null,
              it.preparationTimeMin || 15,
              JSON.stringify(it.selectedCustomizations || []),
            ]
          );
        }

        // Totals and the round count were already applied by the UPDATE that
        // claimed newRoundNumber — writing them again from the values read
        // earlier would clobber a concurrent round's contribution.

        // A round added to a bill the kitchen had already finished has to pull
        // the order back into the active queue — without this the order keeps
        // its 'served' status and the new round is never cooked.
        await recomputeOrderStatus(existing.id, cafeId);

        // Keep the table pinned to the bill this round just joined. A no-op
        // in the normal case, but it heals a table whose occupied flag was
        // lost, rather than leaving the board disagreeing with the orders.
        await query(
          `UPDATE tables SET status = 'occupied', active_order_id = $1 WHERE id = $2 AND cafe_id = $3`,
          [existing.id, orderData.tableId, cafeId]
        );

        const updatedOrders = await fetchFullOrders(cafeId, 'AND id = $2', [existing.id]);
        notifyResourceChanged(cafeId, 'orders');
        notifyResourceChanged(cafeId, 'tables');
        return res.json(updatedOrders[0]);
      }
    }

    // 2. Create fresh new order
    // Worked out before the INSERT below so this order is not counted as part
    // of the backlog it is being measured against.
    const prepTime = await resolveNewRoundPrepTime(orderData, cafeId);

    const orderId = orderData.id || (await allocateOrderId(cafeId));
    console.log('[POST /orders] inserting order id:', orderId);
    await query(
      `INSERT INTO orders (id, cafe_id, table_id, table_number, status, customer_name, customer_phone, special_instructions, payment_method, payment_status, subtotal, tax, service_charge, total, order_rounds_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)`,
      [
        orderId,
        cafeId,
        orderData.tableId,
        orderData.tableNumber,
        orderData.status || 'received',
        orderData.customerName || null,
        orderData.customerPhone || null,
        orderData.specialInstructions || null,
        orderData.paymentMethod || 'counter_cash',
        orderData.paymentStatus || 'pending',
        orderData.subtotal || 0,
        orderData.tax || 0,
        orderData.serviceCharge || 0,
        orderData.total || 0,
      ]
    );
    console.log('[POST /orders] order row inserted, inserting round 1...');

    // Insert Round 1. An order that arrives already 'preparing' (placed on
    // behalf of a table by staff) must get its preparing_started_at here too —
    // that column is what both countdowns measure from, and leaving it null
    // silently reset the timer's origin to placed_at on the next sync.
    const round1Status = orderData.status || 'received';
    const roundRes = await query(
      `INSERT INTO order_rounds (order_id, cafe_id, round_number, placed_at, estimated_prep_time_min, status, preparing_started_at)
       VALUES ($1, $2, 1, now(), $3, $4, CASE WHEN $4 = 'preparing' THEN now() ELSE NULL END)
       RETURNING id`,
      [orderId, cafeId, prepTime, round1Status]
    );
    const roundId = roundRes.rows[0].id;
    console.log('[POST /orders] round 1 inserted, id:', roundId, '| inserting', (orderData.items || []).length, 'items...');

    // Insert Round 1 items
    for (const it of orderData.items || []) {
      const validMenuItemId = await getValidMenuItemId(it.menuItemId);
      console.log('[POST /orders] inserting item:', it.name, '| menuItemId:', validMenuItemId);
      await query(
        `INSERT INTO order_items (order_round_id, cafe_id, menu_item_id, name, price, veg_type, quantity, item_total, special_instructions, preparation_time_min, selected_customizations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          roundId,
          cafeId,
          validMenuItemId,
          it.name,
          it.price,
          it.vegType || 'veg',
          it.quantity,
          it.itemTotal,
          it.specialInstructions || null,
          it.preparationTimeMin || 15,
          JSON.stringify(it.selectedCustomizations || []),
        ]
      );
    }
    console.log('[POST /orders] all items inserted, updating table status...');

    // Mark table occupied
    await query(
      `UPDATE tables SET status = 'occupied', active_order_id = $1 WHERE id = $2 AND cafe_id = $3`,
      [orderId, orderData.tableId, cafeId]
    );
    console.log('[POST /orders] table updated, fetching full order...');

    const created = await fetchFullOrders(cafeId, 'AND id = $2', [orderId]);
    console.log('[POST /orders] success, responding with order:', created[0]?.id);
    notifyResourceChanged(cafeId, 'orders');
    notifyResourceChanged(cafeId, 'tables');
    res.json(created[0]);
  } catch (err: any) {
    console.error('[POST /orders Error]:', err);
    res.status(500).json({
      error: err.message,
      detail: err.detail || undefined,
      hint: err.hint || undefined,
      code: err.code || undefined,
      where: err.where || undefined,
    });
  }
});

// The admin's Paid button: settles a table's open bill and hands the table
// back, so the next order from it starts a fresh order id.
protectedRouter.post('/tables/:id/settle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;

    const openRes = await query(
      `SELECT id FROM orders
       WHERE table_id = $1 AND cafe_id = $2 AND status <> 'cancelled' AND payment_status <> 'paid'
       ORDER BY created_at DESC LIMIT 1`,
      [id, cafeId]
    );

    // Release the table either way. No open bill means it should not have been
    // showing as occupied in the first place, and refusing to free it would
    // leave the admin staring at a Paid button that does nothing.
    if (openRes.rows.length > 0) {
      const orderId = openRes.rows[0].id;
      // A paid bill closes the meal out: any round the kitchen never ticked
      // off is marked served here rather than left sitting on the pass.
      await query(
        `UPDATE orders SET payment_status = 'paid', status = 'served', updated_at = now() WHERE id = $1 AND cafe_id = $2`,
        [orderId, cafeId]
      );
      await query(
        `UPDATE order_rounds SET status = 'served' WHERE order_id = $1 AND cafe_id = $2 AND status <> 'cancelled'`,
        [orderId, cafeId]
      );
    }

    await query(
      `UPDATE tables SET status = 'available', active_order_id = NULL WHERE id = $1 AND cafe_id = $2`,
      [id, cafeId]
    );

    notifyResourceChanged(cafeId, 'orders');
    notifyResourceChanged(cafeId, 'tables');

    const settled = openRes.rows.length > 0
      ? await fetchFullOrders(cafeId, 'AND id = $2', [openRes.rows[0].id])
      : [];
    res.json({ settledOrder: settled[0] || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.patch('/orders/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const { status } = req.body;

    // Status only. Serving deliberately does NOT mark the bill paid: it is
    // payment_status that holds a table's tab open, so settling it here would
    // split the table's next round onto a new order id. Payment happens once,
    // through POST /tables/:id/settle.
    const updatedOrder = await query(
      'UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 AND cafe_id = $3 RETURNING id',
      [status, id, cafeId]
    );
    if (updatedOrder.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    // Update all rounds
    if (status === 'preparing') {
      await query(
        `UPDATE order_rounds SET status = 'preparing', preparing_started_at = COALESCE(preparing_started_at, now()) WHERE order_id = $1 AND cafe_id = $2 AND status = 'received'`,
        [id, cafeId]
      );
    } else if (status === 'ready') {
      await query(
        `UPDATE order_rounds SET status = 'ready', ready_at = COALESCE(ready_at, now()) WHERE order_id = $1 AND cafe_id = $2 AND status IN ('received', 'preparing')`,
        [id, cafeId]
      );
    } else if (status === 'served' || status === 'cancelled') {
      await query('UPDATE order_rounds SET status = $1 WHERE order_id = $2 AND cafe_id = $3', [
        status,
        id,
        cafeId,
      ]);

      // Serving does NOT release the table any more — the party is still
      // seated and can add to this same bill. Only POST /tables/:id/settle
      // (the admin's Paid button) does that.
      //
      // A cancelled order is the exception: there is nothing left to pay, so
      // release the table unless it still has another bill open.
      if (status === 'cancelled') {
        const ordRes = await query('SELECT table_id FROM orders WHERE id = $1 AND cafe_id = $2', [
          id,
          cafeId,
        ]);
        if (ordRes.rows.length > 0) {
          const tableId = ordRes.rows[0].table_id;
          const otherRes = await query(
            `SELECT count(*) FROM orders WHERE table_id = $1 AND cafe_id = $2 AND id != $3 AND status <> 'cancelled' AND payment_status <> 'paid'`,
            [tableId, cafeId, id]
          );
          if (parseInt(otherRes.rows[0].count, 10) === 0) {
            await query(
              `UPDATE tables SET status = 'available', active_order_id = NULL WHERE id = $1 AND cafe_id = $2`,
              [tableId, cafeId]
            );
          }
        }
      }
    }

    const updated = await fetchFullOrders(cafeId, 'AND id = $2', [id]);
    notifyResourceChanged(cafeId, 'orders');
    notifyResourceChanged(cafeId, 'tables');
    res.json(updated[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Recomputes an order's overall status from its rounds and stores it.
//
// Mirrors the client's computeAggregateOrderStatus: a round that is already
// served/cancelled is done and must not count against "are the remaining
// rounds all ready" — otherwise an order with 2 served rounds + 1 ready round
// falls through every check and wrongly lands back on 'preparing', freezing
// the badge at the wrong value forever.
async function recomputeOrderStatus(orderId: string, cafeId: string): Promise<string> {
  const allRounds = await query('SELECT status FROM order_rounds WHERE order_id = $1 AND cafe_id = $2', [
    orderId,
    cafeId,
  ]);
  const statuses = allRounds.rows.map((r) => r.status);
  const activeStatuses = statuses.filter((s) => s !== 'served' && s !== 'cancelled');

  let aggregate = 'preparing';
  if (statuses.every((s) => s === 'served')) aggregate = 'served';
  else if (statuses.every((s) => s === 'cancelled')) aggregate = 'cancelled';
  else if (activeStatuses.length === 0) aggregate = 'served';
  else if (activeStatuses.every((s) => s === 'ready')) aggregate = 'ready';
  else if (activeStatuses.every((s) => s === 'received')) aggregate = 'received';

  await query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 AND cafe_id = $3', [
    aggregate,
    orderId,
    cafeId,
  ]);
  return aggregate;
}

protectedRouter.patch('/orders/:id/rounds/:roundNumber/status', async (req: Request, res: Response) => {
  try {
    const { id, roundNumber } = req.params;
    const cafeId = req.cafeId!;
    const { status } = req.body;
    const rNum = parseInt(roundNumber, 10);

    if (status === 'preparing') {
      await query(
        `UPDATE order_rounds SET status = $1, preparing_started_at = COALESCE(preparing_started_at, now()) WHERE order_id = $2 AND cafe_id = $3 AND round_number = $4`,
        [status, id, cafeId, rNum]
      );
    } else if (status === 'ready') {
      await query(
        `UPDATE order_rounds SET status = $1, ready_at = COALESCE(ready_at, now()) WHERE order_id = $2 AND cafe_id = $3 AND round_number = $4`,
        [status, id, cafeId, rNum]
      );
    } else {
      await query(
        `UPDATE order_rounds SET status = $1 WHERE order_id = $2 AND cafe_id = $3 AND round_number = $4`,
        [status, id, cafeId, rNum]
      );
    }

    const aggregate = await recomputeOrderStatus(id, cafeId);

    const updated = await fetchFullOrders(cafeId, 'AND id = $2', [id]);
    notifyResourceChanged(cafeId, 'orders');
    if (aggregate === 'served' || aggregate === 'cancelled') notifyResourceChanged(cafeId, 'tables');
    res.json(updated[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

protectedRouter.patch('/orders/:id/prep-time', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cafeId = req.cafeId!;
    const { additionalOrTotalMinutes, isAdjustment, roundNumber } = req.body;

    if (roundNumber) {
      if (isAdjustment) {
        await query(
          `UPDATE order_rounds SET estimated_prep_time_min = GREATEST(5, estimated_prep_time_min + $1) WHERE order_id = $2 AND cafe_id = $3 AND round_number = $4`,
          [additionalOrTotalMinutes, id, cafeId, roundNumber]
        );
      } else {
        await query(
          `UPDATE order_rounds SET estimated_prep_time_min = GREATEST(5, $1) WHERE order_id = $2 AND cafe_id = $3 AND round_number = $4`,
          [additionalOrTotalMinutes, id, cafeId, roundNumber]
        );
      }
    } else {
      // Update the active cooking round or last round
      if (isAdjustment) {
        await query(
          `UPDATE order_rounds SET estimated_prep_time_min = GREATEST(5, estimated_prep_time_min + $1) WHERE order_id = $2 AND cafe_id = $3 AND status = 'preparing'`,
          [additionalOrTotalMinutes, id, cafeId]
        );
      } else {
        await query(
          `UPDATE order_rounds SET estimated_prep_time_min = GREATEST(5, $1) WHERE order_id = $2 AND cafe_id = $3 AND status = 'preparing'`,
          [additionalOrTotalMinutes, id, cafeId]
        );
      }
    }

    const updated = await fetchFullOrders(cafeId, 'AND id = $2', [id]);
    notifyResourceChanged(cafeId, 'orders');
    res.json(updated[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mounted last: only requests that didn't match any public route above fall
// through to here, at which point a valid staff JWT is required.
apiRouter.use(requireAuth, protectedRouter);
