"use strict";
/* Шар бази даних: SQLite (вбудований модуль node:sqlite). Усі запити — параметризовані. */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  style       TEXT NOT NULL,
  style_label TEXT NOT NULL,
  country     TEXT NOT NULL,
  brewery     TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price > 0),
  abv         REAL NOT NULL CHECK (abv >= 0 AND abv <= 20),
  pop         INTEGER NOT NULL DEFAULT 100,
  image       TEXT NOT NULL DEFAULT 'img/amber.jpg',
  badge       TEXT NOT NULL DEFAULT '',
  volume      TEXT NOT NULL DEFAULT '0,5 л',
  in_stock    INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1))
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code    TEXT PRIMARY KEY,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 90),
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT NOT NULL,
  delivery       TEXT NOT NULL CHECK (delivery IN ('np', 'pickup')),
  promo_code     TEXT,
  goods          INTEGER NOT NULL,
  discount       INTEGER NOT NULL,
  delivery_price INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'paid', 'shipped', 'done', 'cancelled')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 24)
);

CREATE INDEX IF NOT EXISTS idx_products_style ON products(style);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`;

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
