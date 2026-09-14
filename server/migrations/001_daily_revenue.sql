-- Daily revenue rollup, one row per cafe per business day.
--
-- The orders table stays the source of truth: GET /api/revenue/daily
-- recomputes a month's figures from orders and upserts them here, so this
-- table can always be rebuilt and can never quietly drift out of step.
-- It exists so takings can be queried, exported and kept as a record
-- without re-aggregating every order each time.
--
-- business_date is the calendar day in `time_zone` (the day boundary matters:
-- an 11pm order in Asia/Kolkata falls on the previous day in UTC), and the
-- column records which zone produced the row.
CREATE TABLE IF NOT EXISTS daily_revenue (
  cafe_id        text NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  business_date  date NOT NULL,
  orders_count   integer NOT NULL DEFAULT 0,
  subtotal       numeric(12,2) NOT NULL DEFAULT 0,
  service_charge numeric(12,2) NOT NULL DEFAULT 0,
  tax            numeric(12,2) NOT NULL DEFAULT 0,
  -- What the cafe keeps: subtotal + service charge. Tax is collected on
  -- behalf of the government, so it is tracked but not counted as revenue.
  revenue        numeric(12,2) NOT NULL DEFAULT 0,
  time_zone      text NOT NULL DEFAULT 'UTC',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cafe_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_date ON daily_revenue (business_date DESC);
