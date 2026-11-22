"use strict";
/* Початкові дані: ті самі 6 сортів, що й у статичній верстці лабораторної № 4. */
const PRODUCTS = [
  { id: "autumn-amber", name: "Бурштиновий сезон", style: "ale", style_label: "Amber Ale", country: "ua", brewery: "malt-ember", notes: "Карамель · Апельсин · Хлібна скоринка", price: 145, abv: 5.6, pop: 1, image: "img/amber.jpg", badge: "Сезонне", in_stock: 1 },
  { id: "quiet-forest", name: "Тихий ліс", style: "lager", style_label: "Lager", country: "ua", brewery: "malt-ember", notes: "Солод · Трави · Чистий фініш", price: 115, abv: 4.8, pop: 2, image: "img/forest.jpg", badge: "Вибір куратора", in_stock: 1 },
  { id: "sunny-hops", name: "Сонячний хміль", style: "ipa", style_label: "IPA", country: "ua", brewery: "dykyi-khmil", notes: "Манго · Цитрус · Хмелева гіркота", price: 155, abv: 6.2, pop: 3, image: "img/hop.jpg", badge: "Вибір куратора", in_stock: 1 },
  { id: "midnight-stout", name: "Опівніч", style: "stout", style_label: "Stout", country: "ua", brewery: "chorna-brama", notes: "Кава · Какао · Темний шоколад", price: 165, abv: 7.0, pop: 4, image: "img/midnight.jpg", badge: "Вибір куратора", in_stock: 1 },
  { id: "wild-garden", name: "Дикий сад", style: "ale", style_label: "Pale Ale", country: "ua", brewery: "dykyi-khmil", notes: "Персик · Квіти · Легка гіркота", price: 135, abv: 5.2, pop: 5, image: "img/garden.jpg", badge: "Вибір куратора", in_stock: 1 },
  { id: "north-porter", name: "Північ", style: "porter", style_label: "Baltic Porter", country: "dk", brewery: "nord-bryg", notes: "Чорнослив · Шоколад · Прянощі", price: 185, abv: 8.0, pop: 6, image: "img/north.jpg", badge: "Розпродано", in_stock: 0 }
];
const PROMOS = [{ code: "EMBER10", percent: 10 }, { code: "MALT10", percent: 10 }];

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (count > 0) return false;
  const insertProduct = db.prepare(`INSERT INTO products
    (id, name, style, style_label, country, brewery, notes, price, abv, pop, image, badge, volume, in_stock)
    VALUES (:id, :name, :style, :style_label, :country, :brewery, :notes, :price, :abv, :pop, :image, :badge, '0,5 л', :in_stock)`);
  const insertPromo = db.prepare("INSERT OR IGNORE INTO promo_codes (code, percent) VALUES (:code, :percent)");
  db.exec("BEGIN");
  try {
    PRODUCTS.forEach((p) => insertProduct.run(p));
    PROMOS.forEach((p) => insertPromo.run(p));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return true;
}

module.exports = { seed, PRODUCTS };
