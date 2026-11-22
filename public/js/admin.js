/* admin.js — адмінпанель: CRUD товарів та керування замовленнями через REST API (Bearer-токен). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var TOKEN_KEY = "malt-ember-admin-token";
  var token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { token = ""; }
  var editingId = null;

  async function api(path, options) {
    var init = Object.assign({ headers: { Accept: "application/json", Authorization: "Bearer " + token } }, options || {});
    if (init.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(init.body); }
    var response = await fetch("/api" + path, init);
    var data = null;
    if (response.status !== 204) { try { data = await response.json(); } catch (e) { data = null; } }
    if (!response.ok) {
      var err = new Error((data && data.error) || "Помилка " + response.status);
      err.status = response.status; err.details = data && data.details; throw err;
    }
    return data;
  }

  function cell(text) { var td = document.createElement("td"); td.textContent = text; return td; }
  function btn(text, onClick, label) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick); return b;
  }
  function say(node, text, type) { node.textContent = text; node.dataset.type = type || "success"; }

  async function loadProducts() {
    var list = await api("/products");
    var body = $("#products-body");
    body.replaceChildren.apply(body, list.map(function (p) {
      var tr = document.createElement("tr");
      [p.id, p.name, p.style_label, p.price, String(p.abv).replace(".", ","), p.in_stock ? "так" : "ні"].forEach(function (v) { tr.appendChild(cell(v)); });
      var actions = document.createElement("td");
      actions.appendChild(btn("Редагувати", function () { fillForm(p); }, "Редагувати " + p.name));
      actions.appendChild(btn("Видалити", async function () {
        if (!window.confirm("Видалити «" + p.name + "»?")) return;
        try { await api("/products/" + encodeURIComponent(p.id), { method: "DELETE" }); say($("#form-msg"), "Товар видалено."); await loadProducts(); }
        catch (e) { say($("#form-msg"), e.message, "error"); }
      }, "Видалити " + p.name));
      tr.appendChild(actions);
      return tr;
    }));
  }

  var STATUSES = [["new", "новe"], ["paid", "оплачено"], ["shipped", "відправлено"], ["done", "виконано"], ["cancelled", "скасовано"]];
  async function loadOrders() {
    var list = await api("/orders");
    var body = $("#orders-body");
    if (!list.length) { var tr0 = document.createElement("tr"); var td0 = cell("Замовлень ще немає."); td0.colSpan = 6; tr0.appendChild(td0); body.replaceChildren(tr0); return; }
    body.replaceChildren.apply(body, list.map(function (o) {
      var tr = document.createElement("tr");
      tr.appendChild(cell(o.number));
      tr.appendChild(cell(o.customer_name + " · " + o.phone + " · " + o.email));
      tr.appendChild(cell(o.items.map(function (i) { return i.name + " × " + i.qty; }).join(", ")));
      tr.appendChild(cell(o.total));
      var st = document.createElement("td");
      var select = document.createElement("select");
      select.setAttribute("aria-label", "Статус замовлення " + o.number);
      STATUSES.forEach(function (pair) { var opt = document.createElement("option"); opt.value = pair[0]; opt.textContent = pair[1]; if (pair[0] === o.status) opt.selected = true; select.appendChild(opt); });
      select.addEventListener("change", async function () {
        try { await api("/orders/" + o.id, { method: "PATCH", body: { status: select.value } }); } catch (e) { alert(e.message); await loadOrders(); }
      });
      st.appendChild(select); tr.appendChild(st);
      var act = document.createElement("td");
      act.appendChild(btn("Видалити", async function () {
        if (!window.confirm("Видалити замовлення " + o.number + "?")) return;
        try { await api("/orders/" + o.id, { method: "DELETE" }); await loadOrders(); } catch (e) { alert(e.message); }
      }, "Видалити замовлення " + o.number));
      tr.appendChild(act);
      return tr;
    }));
  }

  var form = $("#product-form");
  function fillForm(p) {
    editingId = p.id;
    ["id", "name", "style", "style_label", "country", "brewery", "price", "abv", "notes", "image"].forEach(function (k) { form.elements[k].value = p[k]; });
    form.elements.in_stock.checked = Boolean(p.in_stock);
    form.elements.id.readOnly = true;
    $("#submit-label").textContent = "Зберегти зміни";
    form.elements.name.focus();
  }
  function clearForm() {
    editingId = null; form.reset(); form.elements.id.readOnly = false;
    $("#submit-label").textContent = "Створити";
  }
  $("#reset-form").addEventListener("click", clearForm);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var f = form.elements;
    var payload = {
      id: f.id.value.trim(), name: f.name.value.trim(), style: f.style.value, style_label: f.style_label.value.trim(),
      country: f.country.value, brewery: f.brewery.value.trim(), price: Number(f.price.value), abv: Number(f.abv.value),
      notes: f.notes.value.trim(), image: f.image.value.trim(), in_stock: f.in_stock.checked
    };
    try {
      if (editingId) await api("/products/" + encodeURIComponent(editingId), { method: "PUT", body: payload });
      else await api("/products", { method: "POST", body: payload });
      say($("#form-msg"), editingId ? "Зміни збережено." : "Товар створено.");
      clearForm(); await loadProducts();
    } catch (e) {
      var extra = e.details ? " " + Object.keys(e.details).map(function (k) { return e.details[k]; }).join(" ") : "";
      say($("#form-msg"), e.message + extra, "error");
    }
  });

  async function enter() {
    try {
      await Promise.all([loadProducts(), loadOrders()]);
      $("#panel").hidden = false;
      say($("#auth-msg"), "Доступ відкрито.");
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* сховище недоступне */ }
    } catch (e) {
      $("#panel").hidden = true;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
      say($("#auth-msg"), e.status === 401 ? "Невірний токен." : e.message, "error");
    }
  }
  $("#auth-form").addEventListener("submit", function (event) {
    event.preventDefault();
    token = $("#token").value.trim();
    enter();
  });
  if (token) enter();
})();
