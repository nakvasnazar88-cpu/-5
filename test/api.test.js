"use strict";
/* Автотести REST API: node --test (вбудований раннер Node.js). Використовують базу в пам'яті. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

const TOKEN = "test-admin-token-123456";
let base; let app;

test.before(async () => {
  app = createApp({ dbPath: ":memory:", adminToken: TOKEN, rateLimit: 1000 });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
});
test.after(() => new Promise((r) => app.server.close(r)));

async function call(method, path, body, headers) {
  const init = { method, headers: Object.assign({}, headers) };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  const res = await fetch(base + path, init);
  let json = null; const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch (e) { json = text; } }
  return { status: res.status, json, headers: res.headers };
}
const auth = { Authorization: "Bearer " + TOKEN };
const customer = { name: "Назар Наквас", phone: "+380501234567", email: "nazar@example.com", ageConfirmed: true };

test("GET /api/health повертає ok і кількість товарів", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200); assert.equal(r.json.status, "ok"); assert.equal(r.json.products, 6);
});

test("GET /api/products: фільтри, пошук і сортування", async () => {
  assert.equal((await call("GET", "/api/products")).json.length, 6);
  const ale = (await call("GET", "/api/products?style=ale")).json;
  assert.deepEqual(ale.map((p) => p.id).sort(), ["autumn-amber", "wild-garden"]);
  const sorted = (await call("GET", "/api/products?sort=price-desc")).json.map((p) => p.price);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a));
  assert.equal((await call("GET", "/api/products?q=кава")).json[0].id, "midnight-stout");
  assert.equal((await call("GET", "/api/products?min_price=150&max_price=160")).json.length, 1);
});

test("GET /api/products/:id: 200, 404 і некоректний id", async () => {
  assert.equal((await call("GET", "/api/products/quiet-forest")).json.name, "Тихий ліс");
  assert.equal((await call("GET", "/api/products/nope")).status, 404);
  assert.equal((await call("GET", "/api/products/BAD%20ID")).status, 400);
});

test("SQL-ін'єкція у параметрах не ламає запити", async () => {
  const r = await call("GET", "/api/products?q=" + encodeURIComponent("' OR 1=1 --"));
  assert.equal(r.status, 200); assert.equal(r.json.length, 0);
  const r2 = await call("GET", "/api/products?style=" + encodeURIComponent("ale' OR '1'='1"));
  assert.equal(r2.status, 200); assert.equal(r2.json.length, 0);
  assert.equal((await call("GET", "/api/health")).json.products, 6);
});

test("Запис товарів без токена заборонено (401), з хибним токеном — 401", async () => {
  assert.equal((await call("POST", "/api/products", {})).status, 401);
  assert.equal((await call("DELETE", "/api/products/autumn-amber")).status, 401);
  assert.equal((await call("POST", "/api/products", {}, { Authorization: "Bearer wrong-token-0000000" })).status, 401);
});

test("CRUD товару: Create → Read → Update → Patch → Delete", async () => {
  const draft = { id: "test-pils", name: "Тестовий пілснер", style: "lager", style_label: "Pilsner", country: "cz", brewery: "test-brewery", price: 99, abv: 4.4, notes: "Хміль · Солод" };
  const created = await call("POST", "/api/products", draft, auth);
  assert.equal(created.status, 201); assert.equal(created.headers.get("location"), "/api/products/test-pils"); assert.equal(created.json.in_stock, true);
  assert.equal((await call("POST", "/api/products", draft, auth)).status, 409);
  assert.equal((await call("GET", "/api/products/test-pils")).json.price, 99);
  const put = await call("PUT", "/api/products/test-pils", Object.assign({}, draft, { price: 110 }), auth);
  assert.equal(put.status, 200); assert.equal(put.json.price, 110);
  const patch = await call("PATCH", "/api/products/test-pils", { in_stock: false }, auth);
  assert.equal(patch.json.in_stock, false);
  assert.equal((await call("DELETE", "/api/products/test-pils", undefined, auth)).status, 204);
  assert.equal((await call("GET", "/api/products/test-pils")).status, 404);
});

test("Валідація товару: 422 з описом помилок", async () => {
  const r = await call("POST", "/api/products", { id: "Bad Id", name: "x", style: "wine", price: -5, abv: 99 }, auth);
  assert.equal(r.status, 422);
  for (const key of ["id", "name", "style", "price", "abv"]) assert.ok(r.json.details[key], key);
  assert.equal((await call("PATCH", "/api/products/autumn-amber", {}, auth)).status, 400);
  assert.equal((await call("PATCH", "/api/products/autumn-amber", { image: "../../etc/passwd" }, auth)).status, 422);
});

test("Некоректний JSON та Content-Type", async () => {
  const bad = await fetch(base + "/api/products", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: "{oops" });
  assert.equal(bad.status, 400);
  const wrong = await fetch(base + "/api/products", { method: "POST", headers: Object.assign({ "Content-Type": "text/plain" }, auth), body: "x" });
  assert.equal(wrong.status, 415);
  const huge = await fetch(base + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(20000) }) }).catch(() => ({ status: 413 }));
  assert.equal(huge.status, 413);
});

test("Промокод: валідний і невалідний", async () => {
  const ok = await call("POST", "/api/promo/validate", { code: " ember10 " });
  assert.equal(ok.status, 200); assert.equal(ok.json.percent, 10);
  assert.equal((await call("POST", "/api/promo/validate", { code: "NOPE123" })).status, 404);
  assert.equal((await call("POST", "/api/promo/validate", { code: "<script>" })).status, 422);
});

test("Замовлення: сума рахується на сервері, клієнтські ціни ігноруються", async () => {
  const r = await call("POST", "/api/orders", { customer, delivery: "np", promo: "EMBER10", items: [{ id: "autumn-amber", qty: 2, price: 1 }, { id: "quiet-forest", qty: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(r.json.goods, 405); assert.equal(r.json.discount, 41); assert.equal(r.json.delivery_price, 80); assert.equal(r.json.total, 444);
  assert.match(r.json.number, /^ME-\d{8}-\d{4}$/); assert.equal(r.json.items.length, 2); assert.equal(r.json.status, "new");
});

test("Безкоштовна доставка від 1500 ₴ та самовивіз", async () => {
  const big = await call("POST", "/api/orders", { customer, delivery: "np", items: [{ id: "midnight-stout", qty: 10 }] });
  assert.equal(big.json.goods, 1650); assert.equal(big.json.delivery_price, 0); assert.equal(big.json.total, 1650);
  const pickup = await call("POST", "/api/orders", { customer, delivery: "pickup", items: [{ id: "quiet-forest", qty: 1 }] });
  assert.equal(pickup.json.total, 115);
});

test("Відхилення замовлень: валідація, відсутній товар, немає в наявності, промокод", async () => {
  const badCustomer = await call("POST", "/api/orders", { customer: { name: "A", phone: "123", email: "x", ageConfirmed: false }, items: [{ id: "quiet-forest", qty: 1 }] });
  assert.equal(badCustomer.status, 422);
  for (const k of ["customer.name", "customer.phone", "customer.email", "customer.ageConfirmed"]) assert.ok(badCustomer.json.details[k], k);
  assert.equal((await call("POST", "/api/orders", { customer, items: [] })).status, 422);
  assert.equal((await call("POST", "/api/orders", { customer, items: [{ id: "quiet-forest", qty: 99 }] })).status, 422);
  assert.equal((await call("POST", "/api/orders", { customer, items: [{ id: "ghost", qty: 1 }] })).status, 422);
  assert.equal((await call("POST", "/api/orders", { customer, items: [{ id: "north-porter", qty: 1 }] })).status, 409);
  assert.equal((await call("POST", "/api/orders", { customer, promo: "FAKE10", items: [{ id: "quiet-forest", qty: 1 }] })).status, 422);
});

test("Керування замовленнями (admin): список, читання, статус, видалення", async () => {
  assert.equal((await call("GET", "/api/orders")).status, 401);
  const list = await call("GET", "/api/orders", undefined, auth);
  assert.equal(list.status, 200); assert.ok(list.json.length >= 3);
  const id = list.json[0].id;
  assert.equal((await call("GET", "/api/orders/" + id, undefined, auth)).json.id, id);
  assert.equal((await call("PATCH", "/api/orders/" + id, { status: "paid" }, auth)).json.status, "paid");
  assert.equal((await call("PATCH", "/api/orders/" + id, { status: "hacked" }, auth)).status, 422);
  assert.equal((await call("DELETE", "/api/orders/" + id, undefined, auth)).status, 204);
  assert.equal((await call("GET", "/api/orders/" + id, undefined, auth)).status, 404);
});

test("Товар із замовлень не можна видалити (409)", async () => {
  assert.equal((await call("DELETE", "/api/products/quiet-forest", undefined, auth)).status, 409);
});

test("Статика: заголовки безпеки, gzip, захист від обходу шляху", async () => {
  const r = await fetch(base + "/index.html", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("content-security-policy").includes("default-src 'self'"));
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const net = require("node:net");
  const raw = await new Promise((resolve) => {
    const s = net.connect(app.server.address().port, "127.0.0.1", () => s.write("GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    let d = ""; s.on("data", (c) => (d += c)); s.on("close", () => resolve(d));
  });
  assert.match(raw, /^HTTP\/1\.1 40[34]/); assert.ok(!raw.includes("createApp"));
  assert.equal((await fetch(base + "/%2e%2e/server.js")).status, 404);
  assert.equal((await fetch(base + "/package.json")).status, 404);
  assert.equal((await fetch(base + "/nothing.html")).status, 404);
});

test("Rate limit повертає 429", async () => {
  const limitedApp = createApp({ dbPath: ":memory:", rateLimit: 3 });
  await new Promise((r) => limitedApp.server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + limitedApp.server.address().port + "/api/promo/validate";
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "EMBER10" }) })).status);
  await new Promise((r) => limitedApp.server.close(r));
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
});

test("Адмін-API вимкнено, якщо ADMIN_TOKEN не заданий (403)", async () => {
  const open = createApp({ dbPath: ":memory:" });
  await new Promise((r) => open.server.listen(0, "127.0.0.1", r));
  const r = await fetch("http://127.0.0.1:" + open.server.address().port + "/api/orders", { headers: { Authorization: "Bearer anything" } });
  await new Promise((rr) => open.server.close(rr));
  assert.equal(r.status, 403);
});
