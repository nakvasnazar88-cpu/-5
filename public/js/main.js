/* ========================================================================== 
   main.js — інтерактивна логіка сайту Malt & Ember.
   Навігація, каталог, обране, галерея, кошик, промокод і валідація форми.
   Лабораторна № 5: дані (товари, промокоди, замовлення) надходять із REST API
   сервера через Fetch API + async/await; статична розмітка лишається запасним варіантом.
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var formatMoney = function (value) {
    return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value) + " ₴";
  };
  var API = "/api";
  var CART_KEY = "malt-ember-cart-v2";
  var FREE_DELIVERY_FROM = 1500;
  var PRODUCT_IDS = {
    "Бурштиновий сезон": "autumn-amber",
    "Тихий ліс": "quiet-forest",
    "Сонячний хміль": "sunny-hops",
    "Опівніч": "midnight-stout",
    "Дикий сад": "wild-garden",
    "Північ": "north-porter"
  };
  var DEFAULT_CART = [
    { id: "autumn-amber", name: "Бурштиновий сезон", meta: "Amber Ale · 5,6% · 0,5 л", price: 145, image: "img/cart-amber.jpg", qty: 2 },
    { id: "quiet-forest", name: "Тихий ліс", meta: "Lager · 4,8% · 0,5 л", price: 115, image: "img/cart-forest.jpg", qty: 1 }
  ];

  /* ---------- Клієнт REST API (Fetch + Promise + async/await) ---------- */
  function ApiError(status, message, details) {
    this.name = "ApiError"; this.status = status; this.message = message; this.details = details || null;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function api(path, options) {
    var init = Object.assign({ headers: { "Accept": "application/json" } }, options || {});
    if (init.body !== undefined && typeof init.body !== "string") {
      init.body = JSON.stringify(init.body);
      init.headers["Content-Type"] = "application/json";
    }
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 8000);
    init.signal = controller.signal;
    var response;
    try {
      response = await fetch(API + path, init);
    } catch (error) {
      throw new ApiError(0, error.name === "AbortError" ? "Сервер не відповів вчасно." : "Немає з'єднання із сервером.");
    } finally {
      window.clearTimeout(timer);
    }
    var data = null;
    if (response.status !== 204) {
      try { data = await response.json(); } catch (error) { data = null; }
    }
    if (!response.ok) throw new ApiError(response.status, (data && data.error) || "Помилка сервера (" + response.status + ").", data && data.details);
    return data;
  }

  var STYLE_FALLBACK_BADGE = "Вибір куратора";
  function svgIcon(name, small) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "icon" + (small ? " icon--sm" : ""));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }
  function formatAbv(value) { return String(value).replace(".", ",").replace(/^(\d+)$/, "$1,0"); }

  /* Картка товару будується через DOM API і textContent — дані з сервера не потрапляють у innerHTML (захист від XSS). */
  function buildCard(product) {
    var card = document.createElement("article");
    card.className = "card" + (product.in_stock ? "" : " card--sold");
    card.setAttribute("data-card", "");
    card.dataset.id = product.id;
    card.dataset.name = product.name;
    card.dataset.notes = product.notes;
    card.dataset.style = product.style;
    card.dataset.country = product.country;
    card.dataset.brewery = product.brewery;
    card.dataset.price = String(product.price);
    card.dataset.abv = String(product.abv);
    card.dataset.pop = String(product.pop);

    var media = document.createElement("div");
    media.className = "card__media";
    var img = document.createElement("img");
    img.src = product.image;
    img.alt = "Пляшка пива «" + product.name + "»";
    img.width = 600; img.height = 560; img.loading = "lazy";
    media.appendChild(img);
    var badgeText = product.in_stock ? (product.badge || "") : "Розпродано";
    if (badgeText) {
      var badge = document.createElement("span");
      badge.className = "badge" + (product.in_stock ? "" : " badge--dark");
      badge.textContent = badgeText;
      media.appendChild(badge);
    }
    var wish = document.createElement("button");
    wish.className = "icon-btn card__wish"; wish.type = "button";
    wish.setAttribute("aria-label", "Додати «" + product.name + "» в обране");
    wish.setAttribute("aria-pressed", "false");
    wish.appendChild(svgIcon("heart"));
    media.appendChild(wish);
    card.appendChild(media);

    var body = document.createElement("div");
    body.className = "card__body";
    var meta = document.createElement("p");
    meta.className = "card__meta";
    meta.textContent = product.style_label + " · " + formatAbv(product.abv) + "%";
    var title = document.createElement("h3");
    title.className = "card__title";
    var link = document.createElement("a");
    link.href = "product.html?id=" + encodeURIComponent(product.id);
    link.textContent = product.name;
    title.appendChild(link);
    var notes = document.createElement("p");
    notes.className = "card__notes";
    notes.textContent = product.notes;
    var buy = document.createElement("div");
    buy.className = "card__buy";
    var price = document.createElement("span");
    price.className = "price";
    price.textContent = new Intl.NumberFormat("uk-UA").format(product.price) + "\u00a0₴";
    var pack = document.createElement("span");
    pack.className = "pack";
    pack.textContent = product.volume.replace(" ", "\u00a0");
    buy.appendChild(price); buy.appendChild(pack);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary btn--block";
    var label = document.createElement("span");
    label.className = "btn__label";
    if (product.in_stock) {
      button.setAttribute("data-add", "");
      label.textContent = "Додати в кошик";
      button.appendChild(label);
      button.appendChild(svgIcon("plus", true));
    } else {
      button.disabled = true;
      label.textContent = "Немає в наявності";
      button.appendChild(label);
    }
    body.appendChild(meta); body.appendChild(title); body.appendChild(notes); body.appendChild(buy); body.appendChild(button);
    card.appendChild(body);
    return card;
  }

  /* Підставляє картки з API у всі контейнери [data-api-grid]; за помилки лишається статична розмітка. */
  async function loadApiGrids() {
    var grids = $$("[data-api-grid]");
    if (!grids.length) return null;
    var products;
    try {
      products = await api("/products");
    } catch (error) {
      showToast("Не вдалося завантажити каталог із сервера — показано збережену версію.", "error");
      return null;
    }
    var currentId = new URLSearchParams(window.location.search).get("id") || "autumn-amber";
    grids.forEach(function (grid) {
      var list = products.filter(function (item) {
        if ("inStock" in grid.dataset && !item.in_stock) return false;
        if ("excludeCurrent" in grid.dataset && item.id === currentId) return false;
        return true;
      });
      if (grid.dataset.limit) list = list.slice(0, Number(grid.dataset.limit));
      grid.replaceChildren.apply(grid, list.map(buildCard));
    });
    return products;
  }

  function readCart() {
    try {
      var saved = localStorage.getItem(CART_KEY);
      if (saved === null) return DEFAULT_CART.map(function (item) { return Object.assign({}, item); });
      var parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (item) {
        return item && typeof item.id === "string" && typeof item.name === "string" &&
          Number.isFinite(Number(item.price)) && Number(item.price) >= 0 && Number(item.qty) > 0;
      }).map(function (item) {
        return {
          id: item.id,
          name: item.name,
          meta: item.meta || "Крафтове пиво · 0,5 л",
          price: Number(item.price),
          image: item.image || "img/amber.jpg",
          qty: Math.min(24, Math.max(1, Math.floor(Number(item.qty))))
        };
      });
    } catch (error) {
      return DEFAULT_CART.map(function (item) { return Object.assign({}, item); });
    }
  }

  var cartItems = readCart();
  var activeDiscount = 0;
  var activePromoCode = "";

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cartItems)); } catch (error) { /* браузер може блокувати localStorage */ }
    updateHeaderCount();
  }

  function totalQuantity() {
    return cartItems.reduce(function (sum, item) { return sum + item.qty; }, 0);
  }

  function updateHeaderCount() {
    $$(".cart-count").forEach(function (badge) {
      badge.textContent = String(totalQuantity());
      badge.setAttribute("aria-label", "Товарів у кошику: " + totalQuantity());
    });
  }

  var toastTimer;
  function showToast(message, type) {
    var toast = $("#site-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "site-toast";
      toast.className = "site-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type || "success";
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove("is-visible"); }, 2600);
  }

  /* ---------- Навігація ---------- */
  var header = $(".site-header");
  var menuButton = $(".nav__menu-btn");
  if (header && menuButton) {
    menuButton.addEventListener("click", function () {
      var isOpen = header.classList.toggle("is-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Закрити меню" : "Відкрити меню");
    });
    $$(".nav__links a", header).forEach(function (link) {
      link.addEventListener("click", function () {
        header.classList.remove("is-open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Відкрити меню");
      });
    });
  }

  /* ---------- Обране та додавання товарів: делегування подій ---------- */
  var currentProduct = null; /* товар, відкритий на product.html (з API або запасний) */

  function getProductFromButton(button) {
    var card = button.closest("[data-card]");
    if (card) {
      var image = $(".card__media img", card);
      var titleLink = $(".card__title a", card);
      var meta = $(".card__meta", card);
      var name = card.dataset.name || (titleLink ? titleLink.textContent.trim() : "Пиво");
      var price = Number(card.dataset.price) || 0;
      return {
        id: card.dataset.id || PRODUCT_IDS[name] || name.toLocaleLowerCase("uk-UA").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""),
        name: name,
        meta: meta ? meta.textContent.trim() + " · 0,5 л" : "Крафтове пиво · 0,5 л",
        price: price,
        image: image ? image.getAttribute("src") : "img/amber.jpg"
      };
    }

    var productPage = button.closest("[data-product]");
    if (productPage && currentProduct) {
      var quantityNode = $("#pdp-qty", productPage);
      return {
        id: currentProduct.id,
        name: currentProduct.name,
        meta: currentProduct.style_label + " · " + formatAbv(currentProduct.abv) + "% · " + currentProduct.volume,
        price: currentProduct.price,
        image: currentProduct.image,
        qty: quantityNode ? Number(quantityNode.textContent) || 1 : 1
      };
    }
    return null;
  }

  function addProduct(product, quantity) {
    if (!product || !product.price) return;
    var amount = Math.min(24, Math.max(1, Number(quantity) || Number(product.qty) || 1));
    var existing = cartItems.find(function (item) { return item.id === product.id; });
    if (existing) existing.qty = Math.min(24, existing.qty + amount);
    else cartItems.push({
      id: product.id,
      name: product.name,
      meta: product.meta,
      price: product.price,
      image: product.image,
      qty: amount
    });
    saveCart();
    showToast("«" + product.name + "» додано до кошика · " + amount + " шт.");
  }

  document.addEventListener("click", function (event) {
    var wishButton = event.target.closest(".card__wish");
    if (wishButton) {
      var selected = wishButton.getAttribute("aria-pressed") !== "true";
      wishButton.setAttribute("aria-pressed", String(selected));
      var card = wishButton.closest("[data-card]");
      var name = card && card.dataset.name ? card.dataset.name : "Товар";
      showToast(selected ? "«" + name + "» додано в обране" : "«" + name + "» видалено з обраного");
      return;
    }

    var addButton = event.target.closest("[data-add]");
    if (addButton && !addButton.disabled) {
      var product = getProductFromButton(addButton);
      addProduct(product, product && product.qty);
      var label = $(".btn__label", addButton);
      if (label) {
        var previous = label.textContent;
        label.textContent = "Додано ✓";
        window.setTimeout(function () { label.textContent = previous; }, 1300);
      }
      return;
    }
  });

  /* ---------- Каталог: пошук, фільтрація, сортування, URL-параметр ---------- */
  function initCatalog() {
  var catalog = $("[data-catalog]");
  if (catalog) {
    var cards = $$('[data-card]', catalog);
    var grid = $("[data-grid]", catalog);
    var countElement = $("[data-result-count]", catalog);
    var searchInput = $("#search-input", catalog);
    var sortSelect = $("#sort", catalog);
    var priceMin = $("#price-min", catalog);
    var priceMax = $("#price-max", catalog);
    var abvMin = $("#abv-min", catalog);
    var abvMax = $("#abv-max", catalog);
    var filterChecks = $$('input[type="checkbox"][data-filter]', catalog);
    var emptyState = $("[data-empty]", catalog);

    var selectedValues = function (filterName) {
      return filterChecks.filter(function (input) {
        return input.dataset.filter === filterName && input.checked;
      }).map(function (input) { return input.value; });
    };

    var applyFilters = function () {
      var query = searchInput ? searchInput.value.trim().toLocaleLowerCase("uk-UA") : "";
      var styles = selectedValues("style");
      var countries = selectedValues("country");
      var breweries = selectedValues("brewery");
      var minPrice = priceMin && priceMin.value !== "" ? Number(priceMin.value) : 0;
      var maxPrice = priceMax && priceMax.value !== "" ? Number(priceMax.value) : Infinity;
      var minAbv = abvMin && abvMin.value !== "" ? Number(abvMin.value) : 0;
      var maxAbv = abvMax && abvMax.value !== "" ? Number(abvMax.value) : Infinity;
      var visibleCount = 0;

      cards.forEach(function (card) {
        var data = card.dataset;
        var haystack = (data.name + " " + data.notes).toLocaleLowerCase("uk-UA");
        var matches = (!query || haystack.indexOf(query) !== -1) &&
          (!styles.length || styles.indexOf(data.style) !== -1) &&
          (!countries.length || countries.indexOf(data.country) !== -1) &&
          (!breweries.length || breweries.indexOf(data.brewery) !== -1) &&
          Number(data.price) >= minPrice && Number(data.price) <= maxPrice &&
          Number(data.abv) >= minAbv && Number(data.abv) <= maxAbv;
        card.hidden = !matches;
        if (matches) visibleCount += 1;
      });

      var sortBy = sortSelect ? sortSelect.value : "popular";
      var sorted = cards.slice().sort(function (a, b) {
        if (sortBy === "price-asc") return Number(a.dataset.price) - Number(b.dataset.price);
        if (sortBy === "price-desc") return Number(b.dataset.price) - Number(a.dataset.price);
        if (sortBy === "abv-desc") return Number(b.dataset.abv) - Number(a.dataset.abv);
        return Number(a.dataset.pop) - Number(b.dataset.pop);
      });
      sorted.forEach(function (card) { grid.appendChild(card); });
      if (countElement) countElement.textContent = "Показано " + visibleCount + " із " + cards.length + " сортів";
      if (emptyState) emptyState.hidden = visibleCount > 0;
    };

    [searchInput, sortSelect, priceMin, priceMax, abvMin, abvMax].forEach(function (input) {
      if (input) input.addEventListener("input", applyFilters);
      if (input && input.tagName === "SELECT") input.addEventListener("change", applyFilters);
    });
    filterChecks.forEach(function (input) { input.addEventListener("change", applyFilters); });

    var params = new URLSearchParams(window.location.search);
    var requestedStyle = params.get("style");
    if (requestedStyle) {
      var matchingStyle = filterChecks.find(function (input) {
        return input.dataset.filter === "style" && input.value === requestedStyle.toLowerCase();
      });
      if (matchingStyle) matchingStyle.checked = true;
    }

    var resetButton = $("[data-reset]", catalog);
    if (resetButton) resetButton.addEventListener("click", function (event) {
      event.preventDefault();
      filterChecks.forEach(function (input) { input.checked = false; });
      if (searchInput) searchInput.value = "";
      if (sortSelect) sortSelect.value = "popular";
      if (priceMin) priceMin.value = 100;
      if (priceMax) priceMax.value = 200;
      if (abvMin) abvMin.value = 4;
      if (abvMax) abvMax.value = 9;
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      applyFilters();
    });

    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      $$(".filters__more details", catalog).forEach(function (details) { details.open = false; });
    }
    applyFilters();
  }
  }

  /* ---------- Сторінка товару: галерея та кількість ---------- */
  var productPage = $("[data-product]");
  var STATIC_PRODUCT = { id: "autumn-amber", name: "Бурштиновий сезон", style_label: "Amber Ale", abv: 5.6, volume: "0,5 л", price: 145, image: "img/cart-amber.jpg", in_stock: true };

  /* Підставляє дані товару з API у розмітку product.html (?id=…). Довгий опис і галерея є лише для «Бурштинового сезону». */
  async function hydrateProductPage() {
    currentProduct = STATIC_PRODUCT;
    var id = new URLSearchParams(window.location.search).get("id") || "autumn-amber";
    var product;
    try {
      product = await api("/products/" + encodeURIComponent(id));
    } catch (error) {
      if (error.status === 404) { showToast("Такого товару не існує — показано «Бурштиновий сезон».", "error"); product = null; }
      else showToast("Не вдалося завантажити товар із сервера — показано збережену версію.", "error");
      if (!product) return null;
    }
    currentProduct = product;
    var set = function (key, text) { var node = $('[data-p="' + key + '"]', productPage.parentNode) || $('[data-p="' + key + '"]'); if (node) node.textContent = text; };
    set("name", product.name);
    set("crumb", product.name);
    set("eyebrow", "Malt & Ember · " + ({ ua: "Україна", dk: "Данія", cz: "Чехія", de: "Німеччина", pl: "Польща" }[product.country] || ""));
    document.title = product.name + " — " + product.style_label + " " + formatAbv(product.abv) + "% · Malt & Ember";
    var meta = $('[data-p="meta"]');
    if (meta) {
      meta.replaceChildren.apply(meta, [product.style_label, formatAbv(product.abv) + "% ABV", product.volume].map(function (text) {
        var span = document.createElement("span"); span.textContent = text; return span;
      }));
    }
    var notes = $('[data-p="notes"]');
    if (notes) {
      notes.replaceChildren.apply(notes, product.notes.split("·").map(function (part) {
        var li = document.createElement("li"); li.className = "chip"; li.textContent = part.trim(); return li;
      }).filter(function (li) { return li.textContent; }));
    }
    set("price", new Intl.NumberFormat("uk-UA").format(product.price) + "\u00a0₴");
    set("stock", product.in_stock ? "У наявності" : "Немає в наявності");
    var badge = $('[data-p="badge"]');
    if (badge) { badge.textContent = product.badge || ""; badge.hidden = !product.badge; }
    var addButton = $("[data-add]", productPage);
    if (addButton) addButton.disabled = !product.in_stock;
    if (product.id !== "autumn-amber") {
      $$("[data-static-only]").forEach(function (node) { node.hidden = true; });
      var main = $("#pdp-main", productPage);
      if (main) { main.src = product.image; main.alt = "Пляшка пива «" + product.name + "»"; }
    }
    return product;
  }

  if (productPage) {
    var mainImage = $("#pdp-main", productPage);
    $$(".gallery__thumb", productPage).forEach(function (thumbnail) {
      thumbnail.addEventListener("click", function () {
        if (mainImage) {
          mainImage.src = thumbnail.dataset.full;
          mainImage.alt = thumbnail.dataset.alt || "Зображення товару";
        }
        $$(".gallery__thumb", productPage).forEach(function (button) { button.removeAttribute("aria-current"); });
        thumbnail.setAttribute("aria-current", "true");
      });
    });

    var quantityOutput = $("#pdp-qty", productPage);
    function changeProductQuantity(delta) {
      if (!quantityOutput) return;
      var current = Number(quantityOutput.textContent) || 1;
      quantityOutput.textContent = String(Math.min(24, Math.max(1, current + delta)));
    }
    var minus = $("[data-qty-minus]", productPage);
    var plus = $("[data-qty-plus]", productPage);
    if (minus) minus.addEventListener("click", function () { changeProductQuantity(-1); });
    if (plus) plus.addEventListener("click", function () { changeProductQuantity(1); });

    var zoomButton = $(".gallery__zoom", productPage);
    if (zoomButton && mainImage) {
      zoomButton.addEventListener("click", function () {
        var dialog = $("#image-lightbox");
        if (!dialog) {
          dialog = document.createElement("dialog");
          dialog.id = "image-lightbox";
          dialog.className = "image-lightbox";
          dialog.innerHTML = '<button class="image-lightbox__close" type="button" aria-label="Закрити">×</button><img alt=""><p>Натисніть Esc або кнопку ×, щоб закрити</p>';
          document.body.appendChild(dialog);
          $(".image-lightbox__close", dialog).addEventListener("click", function () { dialog.close(); });
          dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
        }
        var image = $("img", dialog);
        image.src = mainImage.src;
        image.alt = mainImage.alt;
        if (typeof dialog.showModal === "function") dialog.showModal();
      });
    }
  }

  /* ---------- Кошик: побудова DOM і повний перерахунок ---------- */
  var cartPage = $("[data-cart]");
  if (cartPage) {
    var cartList = $("section[aria-labelledby='cart-items-title'] > ul", cartPage);
    var goodsOutput = $("[data-goods]", cartPage);
    var deliveryOutput = $("[data-delivery]", cartPage);
    var totalOutput = $("[data-total]", cartPage);
    var bottlesOutput = $("[data-bottles]", cartPage);
    var leadOutput = $("[data-lead]");
    var emptyOutput = $("[data-empty]", cartPage);
    var progressText = $("[data-progress-text]", cartPage);
    var progressBar = $("[data-progress-bar]", cartPage);
    var checkoutLink = $("[data-checkout]", cartPage);

    function makeButton(className, label, text, iconName) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.dataset[label] = "";
      button.setAttribute("aria-label", text);
      button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-' + iconName + '"/></svg>';
      return button;
    }

    function makeCartItem(item) {
      var li = document.createElement("li");
      li.className = "cart-item";
      li.dataset.item = "";
      li.dataset.id = item.id;
      li.dataset.price = String(item.price);

      var image = document.createElement("img");
      image.className = "cart-item__thumb";
      image.src = item.image;
      image.alt = "Пляшка пива «" + item.name + "»";
      image.width = 176;
      image.height = 200;
      li.appendChild(image);

      var info = document.createElement("div");
      info.className = "cart-item__info";
      var title = document.createElement("h3");
      title.className = "cart-item__name";
      title.textContent = item.name;
      var meta = document.createElement("p");
      meta.className = "cart-item__meta";
      meta.textContent = item.meta;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cart-item__remove";
      remove.dataset.remove = "";
      remove.textContent = "Видалити · " + formatMoney(item.price) + " / шт.";
      info.appendChild(title);
      info.appendChild(meta);
      info.appendChild(remove);
      li.appendChild(info);

      var qty = document.createElement("div");
      qty.className = "qty qty--sm";
      qty.setAttribute("role", "group");
      qty.setAttribute("aria-label", "Кількість: " + item.name);
      qty.appendChild(makeButton("", "minus", "Зменшити кількість", "minus"));
      var output = document.createElement("output");
      output.dataset.q = "";
      output.textContent = String(item.qty);
      qty.appendChild(output);
      qty.appendChild(makeButton("", "plus", "Збільшити кількість", "plus"));
      li.appendChild(qty);

      var line = document.createElement("p");
      line.className = "cart-item__total";
      line.dataset.line = "";
      line.textContent = formatMoney(item.price * item.qty);
      li.appendChild(line);
      return li;
    }

    function renderCart() {
      if (!cartList) return;
      cartList.replaceChildren.apply(cartList, cartItems.map(makeCartItem));
      var quantity = totalQuantity();
      var goods = cartItems.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
      var discount = Math.round(goods * activeDiscount);
      var selectedDelivery = $("input[name='delivery']:checked", cartPage);
      var delivery = selectedDelivery ? Number(selectedDelivery.dataset.price) || 0 : 0;
      if (goods >= FREE_DELIVERY_FROM && selectedDelivery && selectedDelivery.value === "np") delivery = 0;
      if (!quantity) delivery = 0;

      if (goodsOutput) goodsOutput.textContent = formatMoney(goods);
      if (deliveryOutput) deliveryOutput.textContent = formatMoney(delivery);
      if (totalOutput) totalOutput.textContent = formatMoney(Math.max(0, goods - discount + delivery));
      if (bottlesOutput) bottlesOutput.textContent = "Товари · " + quantity + " " + plural(quantity, ["пляшка", "пляшки", "пляшок"]);
      if (leadOutput) leadOutput.textContent = quantity
        ? quantity + " " + plural(quantity, ["пляшка", "пляшки", "пляшок"]) + " гарного настрою. Перевірте вибір — і ми подбаємо про решту."
        : "Кошик порожній. Оберіть пиво в каталозі.";
      if (emptyOutput) emptyOutput.hidden = quantity > 0;
      if (progressText) {
        var left = Math.max(0, FREE_DELIVERY_FROM - goods);
        progressText.textContent = left ? "Ще " + formatMoney(left) + " — і доставка безкоштовна" : "Доставка безкоштовна 🎉";
      }
      if (progressBar) progressBar.style.width = Math.min(100, goods / FREE_DELIVERY_FROM * 100) + "%";
      if (checkoutLink) {
        checkoutLink.setAttribute("aria-disabled", String(quantity === 0));
        checkoutLink.tabIndex = quantity === 0 ? -1 : 0;
      }
      var discountRow = $("[data-discount-row]", cartPage);
      if (discount > 0) {
        if (!discountRow) {
          discountRow = document.createElement("div");
          discountRow.className = "totals__line totals__line--discount";
          discountRow.dataset.discountRow = "";
          discountRow.innerHTML = "<dt>Знижка (" + activePromoCode + ")</dt><dd data-discount></dd>";
          var totalsLines = $(".totals__lines", cartPage);
          if (totalsLines) totalsLines.appendChild(discountRow);
        }
        $("dt", discountRow).textContent = "Знижка (" + activePromoCode + ")";
        $("[data-discount]", discountRow).textContent = "−" + formatMoney(discount);
      } else if (discountRow) discountRow.remove();

      updateHeaderCount();
    }

    function plural(number, forms) {
      var abs = Math.abs(number) % 100;
      var last = abs % 10;
      if (abs > 10 && abs < 20) return forms[2];
      if (last > 1 && last < 5) return forms[1];
      if (last === 1) return forms[0];
      return forms[2];
    }

    /* Ціни в localStorage можуть бути застарілими або змінені користувачем — звіряємо з сервером. */
    async function syncCartWithServer() {
      if (!cartItems.length) return;
      var products;
      try { products = await api("/products"); } catch (error) { return; }
      var removed = [];
      cartItems = cartItems.filter(function (item) {
        var fresh = products.find(function (p) { return p.id === item.id; });
        if (!fresh || !fresh.in_stock) { removed.push(item.name); return false; }
        item.price = fresh.price; item.name = fresh.name;
        return true;
      });
      if (removed.length) showToast("Недоступні товари видалено з кошика: " + removed.join(", "), "error");
      saveCart();
      renderCart();
    }

    cartPage.addEventListener("click", function (event) {
      var itemElement = event.target.closest("[data-item]");
      if (itemElement) {
        var item = cartItems.find(function (entry) { return entry.id === itemElement.dataset.id; });
        if (!item) return;
        if (event.target.closest("[data-minus]")) item.qty = Math.max(1, item.qty - 1);
        if (event.target.closest("[data-plus]")) item.qty = Math.min(24, item.qty + 1);
        if (event.target.closest("[data-remove]")) {
          cartItems = cartItems.filter(function (entry) { return entry.id !== item.id; });
          showToast("«" + item.name + "» видалено з кошика");
        }
        saveCart();
        renderCart();
      }
    });

    $$('input[name="delivery"]', cartPage).forEach(function (radio) {
      radio.addEventListener("change", renderCart);
    });

    var promoForm = $("[data-promo]", cartPage);
    if (promoForm) {
      var promoInput = $("#promo", promoForm);
      var promoFeedback = document.createElement("p");
      promoFeedback.className = "form-message";
      promoFeedback.setAttribute("aria-live", "polite");
      promoFeedback.dataset.promoFeedback = "";
      promoForm.insertAdjacentElement("afterend", promoFeedback);
      promoForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var code = promoInput ? promoInput.value.trim().toUpperCase() : "";
        activeDiscount = 0;
        activePromoCode = "";
        if (!code) {
          promoFeedback.textContent = "Введіть промокод, щоб перевірити його.";
          promoFeedback.dataset.type = "error";
        } else {
          try {
            var promo = await api("/promo/validate", { method: "POST", body: { code: code } });
            activeDiscount = promo.percent / 100;
            activePromoCode = promo.code;
            promoFeedback.textContent = "Промокод застосовано: знижка " + promo.percent + "% на товари.";
            promoFeedback.dataset.type = "success";
            if (promoInput) promoInput.setAttribute("aria-invalid", "false");
          } catch (error) {
            promoFeedback.textContent = error.status === 404 || error.status === 422
              ? "Промокод не знайдено. Перевірте написання або спробуйте EMBER10."
              : error.message;
            promoFeedback.dataset.type = "error";
            if (promoInput) promoInput.setAttribute("aria-invalid", "true");
          }
        }
        renderCart();
      });
    }

    /* Контактна форма створюється на вимогу, після натискання «Оформити замовлення». */
    var checkoutPanel = document.createElement("section");
    checkoutPanel.className = "checkout-panel";
    checkoutPanel.hidden = true;
    checkoutPanel.setAttribute("aria-labelledby", "checkout-title");
    checkoutPanel.innerHTML = [
      '<h3 id="checkout-title">Контактні дані</h3>',
      '<p class="checkout-panel__intro">Заповніть поля, щоб завершити демонстраційне оформлення.</p>',
      '<form data-order-form novalidate>',
      '  <div class="field"><label class="field__label" for="customer-name">Ім’я та прізвище</label><input class="input" id="customer-name" name="customerName" autocomplete="name" required><p class="field-error" data-error-for="customerName"></p></div>',
      '  <div class="field"><label class="field__label" for="customer-phone">Номер телефону</label><input class="input" id="customer-phone" name="phone" type="tel" autocomplete="tel" placeholder="+380XXXXXXXXX" required><p class="field-error" data-error-for="phone"></p></div>',
      '  <div class="field"><label class="field__label" for="customer-email">Електронна пошта</label><input class="input" id="customer-email" name="email" type="email" autocomplete="email" placeholder="name@example.com" required><p class="field-error" data-error-for="email"></p></div>',
      '  <label class="age-confirm"><input type="checkbox" name="ageConfirmed" required><span>Підтверджую, що мені виповнилося 18 років.</span></label><p class="field-error" data-error-for="ageConfirmed"></p>',
      '  <button class="btn btn--primary btn--block" type="submit">Підтвердити замовлення</button>',
      '  <p class="checkout-feedback" role="status" aria-live="polite"></p>',
      '</form>'
    ].join("");
    if (checkoutLink) checkoutLink.insertAdjacentElement("afterend", checkoutPanel);

    if (checkoutLink) checkoutLink.addEventListener("click", function (event) {
      event.preventDefault();
      if (!cartItems.length) {
        showToast("Спочатку додайте товари до кошика", "error");
        return;
      }
      checkoutPanel.hidden = !checkoutPanel.hidden;
      checkoutLink.setAttribute("aria-expanded", String(!checkoutPanel.hidden));
      if (!checkoutPanel.hidden) {
        checkoutPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        var firstField = $("#customer-name", checkoutPanel);
        if (firstField) firstField.focus({ preventScroll: true });
      }
    });

    var FIELD_BY_PATH = { "customer.name": "customerName", "customer.phone": "phone", "customer.email": "email", "customer.ageConfirmed": "ageConfirmed" };
    var submitting = false;

    checkoutPanel.addEventListener("submit", async function (event) {
      if (!event.target.matches("[data-order-form]")) return;
      event.preventDefault();
      if (submitting) return;
      var form = event.target;
      var values = {
        customerName: $("[name='customerName']", form).value.trim(),
        phone: $("[name='phone']", form).value.trim(),
        email: $("[name='email']", form).value.trim(),
        ageConfirmed: $("[name='ageConfirmed']", form).checked
      };
      var errors = {};
      if (values.customerName.length < 2) errors.customerName = "Вкажіть ім’я та прізвище (не менше 2 символів).";
      var phoneDigits = values.phone.replace(/[\s().-]/g, "");
      if (!/^(?:\+?380\d{9}|0\d{9})$/.test(phoneDigits)) errors.phone = "Введіть український номер у форматі +380XXXXXXXXX або 0XXXXXXXXX.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.email = "Введіть коректну електронну адресу, наприклад name@example.com.";
      if (!values.ageConfirmed) errors.ageConfirmed = "Потрібно підтвердити, що вам виповнилося 18 років.";

      var feedback = $(".checkout-feedback", form);
      var showErrors = function (map) {
        Object.keys(values).forEach(function (name) {
          var input = $("[name='" + name + "']", form);
          var message = $("[data-error-for='" + name + "']", form);
          if (message) message.textContent = map[name] || "";
          if (input) input.setAttribute("aria-invalid", String(Boolean(map[name])));
        });
        var firstInvalid = Object.keys(map)[0];
        if (firstInvalid) {
          if (feedback) { feedback.textContent = "Перевірте позначені поля та виправте помилки."; feedback.dataset.type = "error"; }
          var firstInput = $("[name='" + firstInvalid + "']", form);
          if (firstInput) firstInput.focus();
        }
        return Boolean(firstInvalid);
      };
      if (showErrors(errors)) return;

      var submitButton = $("button[type='submit']", form);
      submitting = true;
      if (submitButton) submitButton.disabled = true;
      if (feedback) { feedback.dataset.type = "success"; feedback.textContent = "Надсилаємо замовлення…"; }
      var deliveryInput = $("input[name='delivery']:checked", cartPage);
      try {
        var order = await api("/orders", {
          method: "POST",
          body: {
            customer: { name: values.customerName, phone: values.phone, email: values.email, ageConfirmed: values.ageConfirmed },
            delivery: deliveryInput ? deliveryInput.value : "np",
            promo: activePromoCode || undefined,
            items: cartItems.map(function (item) { return { id: item.id, qty: item.qty }; })
          }
        });
        if (feedback) {
          feedback.dataset.type = "success";
          feedback.textContent = "Дякуємо, " + values.customerName + "! Замовлення № " + order.number + " прийнято. Сума до сплати: " + formatMoney(order.total) + ". Це навчальний магазин: оплата та відправлення не виконуються.";
        }
        showToast("Замовлення № " + order.number + " створено");
        cartItems = [];
        activeDiscount = 0;
        activePromoCode = "";
        saveCart();
        renderCart();
        form.reset();
      } catch (error) {
        var serverErrors = {};
        Object.keys(error.details || {}).forEach(function (path) { if (FIELD_BY_PATH[path]) serverErrors[FIELD_BY_PATH[path]] = error.details[path]; });
        if (Object.keys(serverErrors).length) showErrors(serverErrors);
        else if (feedback) { feedback.dataset.type = "error"; feedback.textContent = error.message; }
        if (error.status === 409 || error.status === 422) syncCartWithServer();
      } finally {
        submitting = false;
        if (submitButton) submitButton.disabled = false;
      }
    });

    renderCart();
    syncCartWithServer();
  }

  /* ---------- Синхронізація кошика між відкритими вкладками ---------- */
  window.addEventListener("storage", function (event) {
    if (event.key !== CART_KEY) return;
    cartItems = readCart();
    updateHeaderCount();
    if (cartPage) renderCart();
  });

  updateHeaderCount();

  /* ---------- Запуск: спершу дані з API, потім ініціалізація фільтрів і сторінки товару ---------- */
  (async function boot() {
    await loadApiGrids();
    initCatalog();
    if (productPage) await hydrateProductPage();
  })();
})();
