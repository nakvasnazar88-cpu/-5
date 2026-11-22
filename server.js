"use strict";
const { createApp } = require("./src/app");
const port = Number(process.env.PORT) || 3000;
const adminToken = process.env.ADMIN_TOKEN || "";
if (adminToken && adminToken.length < 16) { console.error("ADMIN_TOKEN має містити щонайменше 16 символів."); process.exit(1); }
const { server } = createApp({
  dbPath: process.env.DB_PATH || "./data/malt-ember.db",
  adminToken,
  trustProxy: process.env.TRUST_PROXY === "1"
});
server.listen(port, () => {
  console.log("Malt & Ember: http://localhost:" + port + (adminToken ? "  (admin API увімкнено)" : "  (admin API вимкнено: немає ADMIN_TOKEN)"));
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
