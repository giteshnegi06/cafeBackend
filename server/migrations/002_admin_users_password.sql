-- Real staff accounts: admin_users existed but had no password, so login was
-- a client-side-only facade (any email/password combo worked). Adding a
-- password_hash lets the cafe admin create real kitchen-staff logins and the
-- server actually verify credentials against them.
--
-- Stored as "salt:hash" hex (Node's built-in scrypt, see server/auth.ts) —
-- no bcrypt dependency needed, and scrypt is deliberately slow to brute-force.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash text;
