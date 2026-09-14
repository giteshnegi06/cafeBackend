-- One-time password reset tokens for the "Forgot password?" email flow.
--
-- Only a SHA-256 hash of the token is stored: the raw token exists solely in
-- the emailed link, so a leaked database row can't be used to reset anyone's
-- password. Rows are single-use (used_at) and short-lived (expires_at).
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
