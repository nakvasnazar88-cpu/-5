"use strict";
/* Серверна валідація вхідних даних (клієнтській перевірці довіряти не можна). */
class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STYLES = ["lager", "ale", "ipa", "stout", "porter"];
const COUNTRIES = ["ua", "dk", "cz", "de", "pl"];
const IMAGE = /^img\/[a-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i;
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** full=true — POST/PUT (усі поля обов'язкові); full=false — часткове оновлення. */
function validateProduct(body, full) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Очікується JSON-об'єкт.");
  const errors = {};
  const out = {};
  const need = (key) => full || Object.prototype.hasOwnProperty.call(body, key);

  if (need("id")) { const v = str(body.id); if (!SLUG.test(v) || v.length > 60) errors.id = "id: латиниця, цифри та дефіси (до 60 символів)."; else out.id = v; }
  if (need("name")) { const v = str(body.name); if (v.length < 2 || v.length > 80) errors.name = "name: від 2 до 80 символів."; else out.name = v; }
  if (need("style")) { const v = str(body.style); if (!STYLES.includes(v)) errors.style = "style: одне з " + STYLES.join(", ") + "."; else out.style = v; }
  if (need("style_label")) { const v = str(body.style_label); if (v.length < 2 || v.length > 40) errors.style_label = "style_label: від 2 до 40 символів."; else out.style_label = v; }
  if (need("country")) { const v = str(body.country); if (!COUNTRIES.includes(v)) errors.country = "country: одне з " + COUNTRIES.join(", ") + "."; else out.country = v; }
  if (need("brewery")) { const v = str(body.brewery); if (!SLUG.test(v)) errors.brewery = "brewery: slug (латиниця, цифри, дефіси)."; else out.brewery = v; }
  if (need("price")) { const v = body.price; if (!Number.isInteger(v) || v < 1 || v > 100000) errors.price = "price: ціле число від 1 до 100000."; else out.price = v; }
  if (need("abv")) { const v = body.abv; if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 20) errors.abv = "abv: число від 0 до 20."; else out.abv = v; }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) { const v = str(body.notes); if (v.length > 200) errors.notes = "notes: до 200 символів."; else out.notes = v; }
  if (Object.prototype.hasOwnProperty.call(body, "badge")) { const v = str(body.badge); if (v.length > 40) errors.badge = "badge: до 40 символів."; else out.badge = v; }
  if (Object.prototype.hasOwnProperty.call(body, "image")) { const v = str(body.image); if (!IMAGE.test(v)) errors.image = "image: шлях виду img/назва.jpg."; else out.image = v; }
  if (Object.prototype.hasOwnProperty.call(body, "pop")) { const v = body.pop; if (!Number.isInteger(v) || v < 0 || v > 9999) errors.pop = "pop: ціле число 0–9999."; else out.pop = v; }
  if (Object.prototype.hasOwnProperty.call(body, "in_stock")) { const v = body.in_stock; if (v !== 0 && v !== 1 && typeof v !== "boolean") errors.in_stock = "in_stock: 0/1 або true/false."; else out.in_stock = v ? 1 : 0; }

  if (Object.keys(errors).length) throw new HttpError(422, "Помилка валідації.", errors);
  if (!full && Object.keys(out).length === 0) throw new HttpError(400, "Немає полів для оновлення.");
  return out;
}

function validateOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Очікується JSON-об'єкт.");
  const errors = {};
  const c = body.customer && typeof body.customer === "object" ? body.customer : {};
  const name = str(c.name);
  const phone = str(c.phone).replace(/[\s().-]/g, "");
  const email = str(c.email);
  if (name.length < 2 || name.length > 100) errors["customer.name"] = "Вкажіть ім'я та прізвище (2–100 символів).";
  if (!/^(?:\+?380\d{9}|0\d{9})$/.test(phone)) errors["customer.phone"] = "Український номер: +380XXXXXXXXX або 0XXXXXXXXX.";
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors["customer.email"] = "Некоректна електронна адреса.";
  if (c.ageConfirmed !== true) errors["customer.ageConfirmed"] = "Потрібне підтвердження віку 18+.";

  const delivery = str(body.delivery) || "np";
  if (!["np", "pickup"].includes(delivery)) errors.delivery = "delivery: np або pickup.";

  let promo = null;
  if (body.promo !== undefined && body.promo !== null && body.promo !== "") {
    promo = str(body.promo).toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(promo)) errors.promo = "Некоректний формат промокоду.";
  }

  const items = [];
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) errors.items = "items: непорожній масив (до 50 позицій).";
  else {
    const seen = new Set();
    body.items.forEach((it, i) => {
      const id = it && typeof it.id === "string" ? it.id : "";
      if (!SLUG.test(id) || seen.has(id)) { errors["items." + i] = "Некоректний або дубльований id товару."; return; }
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 24) { errors["items." + i] = "qty: ціле число від 1 до 24."; return; }
      seen.add(id);
      items.push({ id, qty: it.qty });
    });
  }
  if (Object.keys(errors).length) throw new HttpError(422, "Помилка валідації.", errors);
  return { customer: { name, phone, email }, delivery, promo, items };
}

module.exports = { HttpError, validateProduct, validateOrder, SLUG };
