# MALT & EMBER — лабораторна робота № 5

Вебзастосунок «Malt & Ember» (клієнт із лабораторних № 1–4) доповнено **сервером Node.js**, **базою даних SQLite** і **REST API**.

## Архітектура

```
Браузер (HTML/CSS/JS, Fetch API)  ⇄  HTTP/JSON  ⇄  Node.js сервер (src/app.js)  ⇄  SQLite (data/malt-ember.db)
```

- `public/` — клієнтська частина (сторінки, css, js, зображення);
- `src/app.js` — маршрути REST API, роздача статики, заголовки безпеки, rate limit;
- `src/db.js` — схема БД; `src/seed.js` — початкові дані; `src/validate.js` — валідація;
- `test/api.test.js` — 17 автотестів API (`npm test`);
- `docs/` — журнал взаємодії із ШІ, скріншоти.

Сервер не має зовнішніх npm-залежностей: використано вбудовані `http`, `crypto`, `zlib` та `node:sqlite` (потрібен **Node.js ≥ 22.5**).

## Запуск

```bash
cp .env.example .env        # задайте ADMIN_TOKEN (≥ 16 символів)
ADMIN_TOKEN=<ваш-токен> npm start
# http://localhost:3000
npm test
```

Адмінпанель: `/admin.html` (потрібен ADMIN_TOKEN). Без токена адмін-API вимкнено.

## REST API

| Метод | Маршрут | Доступ | Опис |
|---|---|---|---|
| GET | `/api/health` | публічний | стан сервера |
| GET | `/api/config` | публічний | доставка, ліміти |
| GET | `/api/products?style=&country=&brewery=&q=&min_price=&max_price=&min_abv=&max_abv=&sort=` | публічний | список (Read) |
| GET | `/api/products/:id` | публічний | один товар (Read) |
| POST | `/api/products` | admin | створення (Create) |
| PUT / PATCH | `/api/products/:id` | admin | повне / часткове оновлення (Update) |
| DELETE | `/api/products/:id` | admin | видалення (Delete) |
| POST | `/api/promo/validate` | публічний, rate limit | перевірка промокоду |
| POST | `/api/orders` | публічний, rate limit | створення замовлення (суму рахує сервер) |
| GET | `/api/orders`, `/api/orders/:id` | admin | перегляд замовлень |
| PATCH | `/api/orders/:id` | admin | зміна статусу |
| DELETE | `/api/orders/:id` | admin | видалення замовлення |

Коди відповідей: 200, 201, 204, 400, 401, 403, 404, 409, 413, 415, 422, 429, 500.

## Модель даних

`products(id, name, style, style_label, country, brewery, notes, price, abv, pop, image, badge, volume, in_stock)` ·
`promo_codes(code, percent, active)` · `orders(id, number, customer_name, phone, email, delivery, promo_code, goods, discount, delivery_price, total, status, created_at)` ·
`order_items(id, order_id → orders, product_id → products, name, price, qty)`.

## Безпека

Параметризовані SQL-запити; серверна валідація; ціни й знижки рахуються лише на сервері; Bearer-токен із `ADMIN_TOKEN` (порівняння `timingSafeEqual`); секрети лише в змінних середовища; CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; обмеження розміру тіла (16 КБ) та rate limit; захист від обходу шляху в статиці; клієнт будує DOM через `textContent` (без `innerHTML` для даних сервера).

## Розгортання

Render / Railway / Fly.io: репозиторій містить `render.yaml` і `Dockerfile`. Команда запуску — `npm start`, перевірка здоров'я — `/api/health`. Для збереження БД між перезапусками підключіть диск і вкажіть `DB_PATH`.
