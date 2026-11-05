// Bygger public/ från src/ och skriver config.js från miljövariablerna
// SUPABASE_URL och SUPABASE_ANON_KEY (anon-nyckeln är publik av design,
// det är databasens behörighetsregler som skyddar datan).
"use strict";
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "src");
const out = path.join(__dirname, "public");

const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_ANON_KEY || "").trim();

function fail(msg) {
  console.error("\nBygget stoppades: " + msg + "\n");
  process.exit(1);
}

if (Boolean(url) !== Boolean(key)) {
  fail("Både SUPABASE_URL och SUPABASE_ANON_KEY måste anges, eller ingen av dem (då byggs ett demoläge).");
}

if (url) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    fail("SUPABASE_URL ska se ut som https://xxxxxxxx.supabase.co");
  }
  // Skydd mot att den hemliga nyckeln hamnar i webbläsaren av misstag.
  if (/^sb_secret_/.test(key)) {
    fail("SUPABASE_ANON_KEY är en hemlig nyckel (sb_secret_...). Använd den publika nyckeln (anon eller publishable).");
  }
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") {
        fail("SUPABASE_ANON_KEY är service_role-nyckeln. Den får aldrig läggas i webbplatsen. Använd anon-nyckeln.");
      }
    } catch (e) {
      /* inte en JWT som går att läsa, släpp igenom */
    }
  }
} else {
  console.warn("\nVarning: SUPABASE_URL och SUPABASE_ANON_KEY saknas. Webbplatsen byggs i demoläge utan databas.\n");
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.writeFileSync(
  path.join(out, "config.js"),
  "window.APP_CONFIG = " + JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key }) + ";\n"
);
console.log("Byggde public/" + (url ? " med databasen " + url : " i demoläge"));
