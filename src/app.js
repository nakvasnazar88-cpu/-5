"use strict";
/* REST API + роздача статики. Без зовнішніх залежностей: вбудовані http, zlib, crypto, sqlite. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { openDb } = require("./db");
const { seed } = require("./seed");
const { HttpError, validateProduct, validateOrder, SLUG } = require("./validate");

const FREE_DELIVERY_FROM = 1500;
const DELIVERY_PRICE = { np: 80, pickup: 0 };
const ORDER_STATUSES = ["new", "paid", "shipped", "done", "cancelled"];
const MAX_BODY = 16 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function createApp(options) {
  const opts = Object.assign({ dbPath: "./data/malt-ember.db", adminToken: "", publicDir: path.join(__dirname, "..", "public"), trustProxy: false, rateLimit: 30 }, options);
  const db = openDb(opts.dbPath);
  seed(db);
  const publicRoot = path.resolve(opts.publicDir);
  const adminBuf = opts.adminToken ? Buffer.from(opts.adminToken) : null;

  /* ---------- Утиліти ---------- */
  function send(res, status, payload, extra) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS, extra));
    res.end(body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers["content-type"] || "");
      if (!type.toLowerCase().startsWith("application/json")) return reject(new HttpError(415, "Content-Type має бути application/json."));
      let size = 0; const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "Тіло запиту завелике.")); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); }
        catch (e) { reject(new HttpError(400, "Некоректний JSON.")); }
      });
      req.on("error", reject);
    });
  }

  function requireAdmin(req) {
    if (!adminBuf) throw new HttpError(403, "Адміністративний доступ вимкнено: не задано ADMIN_TOKEN.");
    const header = String(req.headers.authorization || "");
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    const ok = given.length === adminBuf.length && crypto.timingSafeEqual(given, adminBuf);
    if (!ok) throw new HttpError(401, "Потрібен дійсний токен адміністратора.");
  }

  const hits = new Map();
  function limited(req) {
    const fwd = opts.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
    const ip = fwd || req.socket.remoteAddress || "?";
    const now = Date.now();
    const entry = (hits.get(ip) || []).filter((t) => now - t < 60000);
    entry.push(now); hits.set(ip, entry);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
    return entry.length > opts.rateLimit;
  }

  const rowToProduct = (r) => r && Object.assign({}, r, { in_stock: Boolean(r.in_stock) });

  /* ---------- Підготовлені запити ---------- */
  const q = {
    one: db.prepare("SELECT * FROM products WHERE id = ?"),
    insert: db.prepare(`INSERT INTO products (id, name, style, style_label, country, brewery, notes, price, abv, pop, image, badge, volume, in_stock)
      VALUES (:id, :name, :style, :style_label, :country, :brewery, :notes, :price, :abv, :pop, :image, :badge, :volume, :in_stock)`),
    del: db.prepare("DELETE FROM products WHERE id = ?"),
    promo: db.prepare("SELECT code, percent FROM promo_codes WHERE code = ? AND active = 1"),
    orderIns: db.prepare(`INSERT INTO orders (number, customer_name, phone, email, delivery, promo_code, goods, discount, delivery_price, total)
      VALUES (:number, :name, :phone, :email, :delivery, :promo, :goods, :discount, :deliveryPrice, :total)`),
    itemIns: db.prepare("INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)"),
    orderOne: db.prepare("SELECT * FROM orders WHERE id = ?"),
    orderItems: db.prepare("SELECT product_id, name, price, qty FROM order_items WHERE order_id = ? ORDER BY id"),
    orderDel: db.prepare("DELETE FROM orders WHERE id = ?")
  };

  function orderWithItems(id) {
    const order = q.orderOne.get(id);
    if (!order) return null;
    return Object.assign({}, order, { items: q.orderItems.all(id) });
  }

  /* ---------- Обробники ---------- */
  function listProducts(url) {
    const p = url.searchParams;
    const where = []; const args = [];
    for (const key of ["style", "country", "brewery"]) {
      const v = p.get(key);
      if (v) { where.push(`${key} IN (${v.split(",").map(() => "?").join(",")})`); args.push(...v.split(",").map((s) => s.trim().toLowerCase())); }
    }
    /* SQLite LOWER() не обробляє кирилицю, тому текстовий пошук виконується в JS після вибірки з БД. */
    const search = (p.get("q") || "").trim().slice(0, 60).toLocaleLowerCase("uk-UA");
    const num = (k) => (p.get(k) !== null && p.get(k) !== "" && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : null);
    if (num("min_price") !== null) { where.push("price >= ?"); args.push(num("min_price")); }
    if (num("max_price") !== null) { where.push("price <= ?"); args.push(num("max_price")); }
    if (num("min_abv") !== null) { where.push("abv >= ?"); args.push(num("min_abv")); }
    if (num("max_abv") !== null) { where.push("abv <= ?"); args.push(num("max_abv")); }
    const orderBy = { "price-asc": "price ASC", "price-desc": "price DESC", "abv-desc": "abv DESC" }[p.get("sort")] || "pop ASC";
    const sql = "SELECT * FROM products" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY " + orderBy + ", id";
    let rows = db.prepare(sql).all(...args);
    if (search) rows = rows.filter((r) => (r.name + " " + r.notes).toLocaleLowerCase("uk-UA").includes(search));
    return rows.map(rowToProduct);
  }

  function createProduct(body) {
    const data = validateProduct(body, true);
    if (q.one.get(data.id)) throw new HttpError(409, "Товар з таким id уже існує.");
    q.insert.run(Object.assign({ notes: "", pop: 100, image: "img/amber.jpg", badge: "", volume: "0,5 л", in_stock: 1 }, data));
    return rowToProduct(q.one.get(data.id));
  }

  function updateProduct(id, body, full) {
    if (!q.one.get(id)) throw new HttpError(404, "Товар не знайдено.");
    const data = validateProduct(body, full);
    if (data.id && data.id !== id) throw new HttpError(422, "id змінювати не можна.", { id: "id незмінний." });
    delete data.id;
    const keys = Object.keys(data);
    if (keys.length) db.prepare("UPDATE products SET " + keys.map((k) => `${k} = :${k}`).join(", ") + " WHERE id = :__id").run(Object.assign({}, data, { __id: id }));
    return rowToProduct(q.one.get(id));
  }

  function calcOrder(items, delivery, promoCode) {
    let goods = 0; const lines = [];
    for (const it of items) {
      const product = q.one.get(it.id);
      if (!product) throw new HttpError(422, "Товар не знайдено: " + it.id, { items: "Невідомий товар " + it.id });
      if (!product.in_stock) throw new HttpError(409, "Товару немає в наявності: " + product.name, { items: "Немає в наявності: " + product.name });
      goods += product.price * it.qty;
      lines.push({ product, qty: it.qty });
    }
    let percent = 0; let appliedCode = null;
    if (promoCode) {
      const promo = q.promo.get(promoCode);
      if (!promo) throw new HttpError(422, "Промокод не знайдено.", { promo: "Промокод не знайдено." });
      percent = promo.percent; appliedCode = promo.code;
    }
    const discount = Math.round(goods * percent / 100);
    let deliveryPrice = DELIVERY_PRICE[delivery];
    if (delivery === "np" && goods >= FREE_DELIVERY_FROM) deliveryPrice = 0;
    return { lines, goods, discount, deliveryPrice, total: Math.max(0, goods - discount + deliveryPrice), promo: appliedCode };
  }

  function createOrder(body) {
    const data = validateOrder(body);
    const calc = calcOrder(data.items, data.delivery, data.promo);
    db.exec("BEGIN");
    try {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const tmp = "tmp-" + crypto.randomBytes(6).toString("hex");
      const info = q.orderIns.run({ number: tmp, name: data.customer.name, phone: data.customer.phone, email: data.customer.email,
        delivery: data.delivery, promo: calc.promo, goods: calc.goods, discount: calc.discount, deliveryPrice: calc.deliveryPrice, total: calc.total });
      const id = Number(info.lastInsertRowid);
      db.prepare("UPDATE orders SET number = ? WHERE id = ?").run("ME-" + stamp + "-" + String(id).padStart(4, "0"), id);
      calc.lines.forEach((l) => q.itemIns.run(id, l.product.id, l.product.name, l.product.price, l.qty));
      db.exec("COMMIT");
      return orderWithItems(id);
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [resource, id] = parts;
    const idCheck = () => { if (!SLUG.test(id)) throw new HttpError(400, "Некоректний id."); };
    const intId = () => { if (!/^\d{1,9}$/.test(id || "")) throw new HttpError(400, "Некоректний id."); return Number(id); };

    if (resource === "health" && method === "GET" && parts.length === 1) {
      return send(res, 200, { status: "ok", products: db.prepare("SELECT COUNT(*) AS n FROM products").get().n, time: new Date().toISOString() });
    }
    if (resource === "config" && method === "GET" && parts.length === 1) {
      return send(res, 200, { freeDeliveryFrom: FREE_DELIVERY_FROM, delivery: DELIVERY_PRICE, maxQty: 24 });
    }

    if (resource === "products") {
      if (parts.length === 1 && method === "GET") return send(res, 200, listProducts(url));
      if (parts.length === 1 && method === "POST") { requireAdmin(req); const created = createProduct(await readJson(req)); return send(res, 201, created, { Location: "/api/products/" + created.id }); }
      if (parts.length === 2) {
        idCheck();
        if (method === "GET") { const r = q.one.get(id); if (!r) throw new HttpError(404, "Товар не знайдено."); return send(res, 200, rowToProduct(r)); }
        if (method === "PUT") { requireAdmin(req); return send(res, 200, updateProduct(id, await readJson(req), true)); }
        if (method === "PATCH") { requireAdmin(req); return send(res, 200, updateProduct(id, await readJson(req), false)); }
        if (method === "DELETE") {
          requireAdmin(req);
          if (!q.one.get(id)) throw new HttpError(404, "Товар не знайдено.");
          try { q.del.run(id); } catch (e) { throw new HttpError(409, "Товар використовується в замовленнях; позначте in_stock=false замість видалення."); }
          return send(res, 204);
        }
      }
    }

    if (resource === "promo" && id === "validate" && method === "POST" && parts.length === 2) {
      if (limited(req)) throw new HttpError(429, "Забагато запитів. Спробуйте за хвилину.");
      const body = await readJson(req);
      const code = body && typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new HttpError(422, "Некоректний формат промокоду.");
      const promo = q.promo.get(code);
      if (!promo) throw new HttpError(404, "Промокод не знайдено.");
      return send(res, 200, { code: promo.code, percent: promo.percent });
    }

    if (resource === "orders") {
      if (parts.length === 1 && method === "POST") {
        if (limited(req)) throw new HttpError(429, "Забагато запитів. Спробуйте за хвилину.");
        const order = createOrder(await readJson(req));
        return send(res, 201, order, { Location: "/api/orders/" + order.id });
      }
      if (parts.length === 1 && method === "GET") {
        requireAdmin(req);
        return send(res, 200, db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all().map((o) => Object.assign({}, o, { items: q.orderItems.all(o.id) })));
      }
      if (parts.length === 2) {
        requireAdmin(req);
        const oid = intId();
        if (method === "GET") { const o = orderWithItems(oid); if (!o) throw new HttpError(404, "Замовлення не знайдено."); return send(res, 200, o); }
        if (method === "PATCH") {
          if (!orderWithItems(oid)) throw new HttpError(404, "Замовлення не знайдено.");
          const body = await readJson(req);
          if (!body || !ORDER_STATUSES.includes(body.status)) throw new HttpError(422, "status: одне з " + ORDER_STATUSES.join(", ") + ".", { status: "Недопустиме значення." });
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(body.status, oid);
          return send(res, 200, orderWithItems(oid));
        }
        if (method === "DELETE") { if (!orderWithItems(oid)) throw new HttpError(404, "Замовлення не знайдено."); q.orderDel.run(oid); return send(res, 204); }
      }
    }
    throw new HttpError(404, "Маршрут не знайдено.");
  }

  /* ---------- Статичні файли ---------- */
  const gzCache = new Map();
  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Метод не дозволено." }, { Allow: "GET, HEAD" });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, { error: "Некоректний шлях." }); }
    if (rel.includes("\0")) return send(res, 400, { error: "Некоректний шлях." });
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(publicRoot, "." + path.sep + rel);
    if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) return send(res, 403, { error: "Заборонено." });
    const ext = path.extname(file).toLowerCase();
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return notFoundPage(res); }
    if (!stat.isFile() || !MIME[ext]) return notFoundPage(res);
    const etag = '"' + stat.size.toString(16) + "-" + Math.floor(stat.mtimeMs).toString(16) + '"';
    const headers = Object.assign({ "Content-Type": MIME[ext], ETag: etag,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" }, SECURITY_HEADERS);
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    let body = null;
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      let hit = gzCache.get(file);
      if (!hit || hit.etag !== etag) { hit = { etag, buf: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, hit); }
      body = hit.buf; headers["Content-Encoding"] = "gzip"; headers.Vary = "Accept-Encoding";
    }
    if (req.method === "HEAD") { res.writeHead(200, headers); return res.end(); }
    if (body) { headers["Content-Length"] = body.length; res.writeHead(200, headers); return res.end(body); }
    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }

  function notFoundPage(res) {
    res.writeHead(404, Object.assign({ "Content-Type": "text/html; charset=utf-8" }, SECURITY_HEADERS));
    res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><title>404 — Malt &amp; Ember</title><body style="font-family:sans-serif;padding:2rem"><h1>Сторінку не знайдено</h1><p><a href="/index.html">На головну</a></p></body></html>');
  }

  /* ---------- Сервер ---------- */
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) send(res, err.status, { error: err.message, details: err.details });
      } else {
        console.error("[error]", err);
        if (!res.headersSent) send(res, 500, { error: "Внутрішня помилка сервера." });
      }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => { try { db.close(); } catch (e) { /* вже закрито */ } });
  return { server, db };
}

module.exports = { createApp };
