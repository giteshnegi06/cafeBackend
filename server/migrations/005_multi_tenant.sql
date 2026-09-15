-- Multi-tenancy: this database is moving from "one database per cafe" to a
-- single shared database serving every cafe, scoped by cafe_id. Most tables
-- already carry cafe_id; this migration adds it to the two that don't
-- (order_rounds, order_items) and widens the uniqueness constraints that
-- would otherwise collide once multiple cafes' rows share these tables.
--
-- Safe to run against the existing single-cafe database before its data is
-- copied into the shared one — every statement is idempotent/backfilling.

ALTER TABLE order_rounds ADD COLUMN IF NOT EXISTS cafe_id text REFERENCES cafes(id) ON DELETE CASCADE;
UPDATE order_rounds r SET cafe_id = o.cafe_id FROM orders o WHERE r.order_id = o.id AND r.cafe_id IS NULL;
ALTER TABLE order_rounds ALTER COLUMN cafe_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_rounds_cafe ON order_rounds (cafe_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cafe_id text REFERENCES cafes(id) ON DELETE CASCADE;
UPDATE order_items i SET cafe_id = r.cafe_id FROM order_rounds r WHERE i.order_round_id = r.id AND i.cafe_id IS NULL;
ALTER TABLE order_items ALTER COLUMN cafe_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_cafe ON order_items (cafe_id);

-- admin_users.email and tables.code were globally unique (fine when each
-- cafe had its own database); scope them to (cafe_id, ...) instead.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_email_key;
ALTER TABLE admin_users ADD CONSTRAINT uq_admin_users_cafe_email UNIQUE (cafe_id, email);

ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_code_key;
ALTER TABLE tables ADD CONSTRAINT uq_tables_cafe_code UNIQUE (cafe_id, code);

CREATE INDEX IF NOT EXISTS idx_menu_items_cafe ON menu_items (cafe_id);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_created ON orders (cafe_id, created_at DESC);

-- orders.id (e.g. "ORD-1001") is only allocated unique PER CAFE. On a single
-- shared table, two different cafes can legitimately land on the same id, so
-- the primary key must be (cafe_id, id), not id alone — otherwise the second
-- cafe's insert is rejected by the old single-column PRIMARY KEY.
ALTER TABLE order_rounds DROP CONSTRAINT IF EXISTS order_rounds_order_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pkey;
ALTER TABLE orders ADD CONSTRAINT pk_orders PRIMARY KEY (cafe_id, id);
ALTER TABLE order_rounds ADD CONSTRAINT fk_order_rounds_order
  FOREIGN KEY (cafe_id, order_id) REFERENCES orders (cafe_id, id) ON DELETE CASCADE;

-- order_id (e.g. "ORD-1002") is only unique per cafe — same reasoning as
-- orders.id above. Two different cafes' orders sharing an id must still be
-- able to each have their own round 1, round 2, etc.
ALTER TABLE order_rounds DROP CONSTRAINT IF EXISTS uq_order_round;
ALTER TABLE order_rounds ADD CONSTRAINT uq_order_round UNIQUE (cafe_id, order_id, round_number);

-- admin_users/categories/menu_items/tables/service_requests ids are NOT
-- cryptographically random (deterministic sequences like "table-01", or
-- client Date.now()-based ids like "cat-1737..."/"staff-1737...") — safe
-- when each cafe has its own database, but two different cafes CAN land on
-- the exact same id in a shared one. Widen each to a composite primary key.
-- Cross-table single-column FKs that pointed at these ids become plain
-- columns (the app always has cafe_id in scope to join correctly); losing
-- ON DELETE CASCADE/SET NULL on these specific lookups is an acceptable
-- trade for eliminating cross-tenant id collisions.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_table_id_fkey;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_menu_item_id_fkey;

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_pkey;
ALTER TABLE admin_users ADD CONSTRAINT pk_admin_users PRIMARY KEY (cafe_id, id);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE categories ADD CONSTRAINT pk_categories PRIMARY KEY (cafe_id, id);

ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_pkey;
ALTER TABLE menu_items ADD CONSTRAINT pk_menu_items PRIMARY KEY (cafe_id, id);

ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_pkey;
ALTER TABLE tables ADD CONSTRAINT pk_tables PRIMARY KEY (cafe_id, id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_table FOREIGN KEY (cafe_id, table_id) REFERENCES tables (cafe_id, id) ON DELETE CASCADE;

ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_pkey;
ALTER TABLE service_requests ADD CONSTRAINT pk_service_requests PRIMARY KEY (cafe_id, id);

-- password_resets needs cafe_id added since admin_users.id is no longer
-- globally unique on its own (user_id alone can't identify the right row).
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS cafe_id text REFERENCES cafes(id) ON DELETE CASCADE;
UPDATE password_resets r SET cafe_id = u.cafe_id FROM admin_users u WHERE r.user_id = u.id AND r.cafe_id IS NULL;
ALTER TABLE password_resets ALTER COLUMN cafe_id SET NOT NULL;
ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_user_id_fkey;
