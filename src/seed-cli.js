"use strict";
const { openDb } = require("./db");
const { seed } = require("./seed");
const db = openDb(process.env.DB_PATH || "./data/malt-ember.db");
console.log(seed(db) ? "Базу заповнено початковими даними." : "Дані вже існують — пропущено.");
