#!/usr/bin/env node
/**
 * Família Steam — retrospectiva de compras da família Steam
 * Zero dependências. Apenas Node.js >= 22.
 *
 * Uso:
 *   node server.js --set-password      # define a senha única da família (ou usa env PASSWORD)
 *   node server.js                     # inicia em http://127.0.0.1:3001
 *   PORT=3001 BIND=127.0.0.1 node server.js
 *   node server.js --daemon [porta]    # modo serviço (estilo pm2)
 *   node server.js --status            # mostra pid/porta do serviço
 *   node server.js --stop              # para o serviço
 *
 * Acesso: senha única compartilhada com toda a família (sem usuários).
 * Atrás do Cloudflare Tunnel, rode ouvindo em 127.0.0.1 e aponte o tunnel para lá.
 *
 * Limitação conhecida: a API pública da Steam (appdetails/storesearch) informa
 * apenas o preço ATUAL do jogo, não o histórico. Por isso o fluxo de cadastro
 * busca nome/capa/preço atual na hora e a família confirma o valor pago no dia.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const DB_PATH = path.join(DATA_DIR, "fsteam.db");
const PUBLIC_DIR = path.join(__dirname, "public");
const PID_FILE = path.join(DATA_DIR, "service.pid");
const PORT_FILE = path.join(DATA_DIR, "service.port");
const LOG_FILE = path.join(DATA_DIR, "service.log");

const PORT = parseInt(process.env.PORT || "3001", 10);
const BIND = process.env.BIND || "127.0.0.1";
const TRUST_PROXY = (process.env.TRUST_PROXY || "1") === "1"; // cloudflared envia X-Forwarded-For/Proto
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias (senha compartilhada, troca manual)

const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const STEAM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STEAM_SEARCH_TTL_MS = 10 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(AVATAR_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ---------------- DB ----------------
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  pass_hash BLOB NOT NULL,
  pass_salt BLOB NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appid INTEGER NOT NULL,
  game_name TEXT NOT NULL,
  header_image TEXT NOT NULL DEFAULT '',
  steam_url TEXT NOT NULL DEFAULT '',
  buyer_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purchase_date TEXT NOT NULL,
  price_paid_cents INTEGER NOT NULL DEFAULT 0,
  price_source TEXT NOT NULL DEFAULT 'manual' CHECK(price_source IN ('manual','steam-atual')),
  is_gift INTEGER NOT NULL DEFAULT 0,
  gift_to_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_member_id);
CREATE TABLE IF NOT EXISTS purchase_splits (
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  PRIMARY KEY (purchase_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_splits_member ON purchase_splits(member_id);
CREATE TABLE IF NOT EXISTS steam_cache (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  header_image TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
`);

// migração da versão com usuários: senha única herda o hash do 1º usuário,
// tabelas users/sessions antigas são removidas, created_by sai de purchases.
try {
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasUsers) {
    const authRow = db.prepare("SELECT id FROM auth WHERE id=1").get();
    if (!authRow) {
      try {
        const u = db.prepare("SELECT pass_hash, pass_salt, failed_attempts, locked_until FROM users ORDER BY id LIMIT 1").get();
        if (u) db.prepare("INSERT INTO auth(id,pass_hash,pass_salt,failed_attempts,locked_until,updated_at) VALUES(1,?,?,?,?,?)").run(u.pass_hash, u.pass_salt, u.failed_attempts || 0, u.locked_until || 0, Date.now());
      } catch {}
    }
    db.exec("PRAGMA foreign_keys=OFF;");
    try { db.exec("ALTER TABLE purchases DROP COLUMN created_by"); } catch {}
    try { db.exec("DROP TABLE sessions"); } catch {}
    try { db.exec("DROP TABLE users"); } catch {}
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      csrf TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT ''
    );`);
    db.exec("PRAGMA foreign_keys=ON;");
    console.log("Migração concluída: acesso agora é por senha única (a senha anterior foi mantida).");
  }
} catch { try { db.exec("PRAGMA foreign_keys=ON;"); } catch {} }
try { db.exec("ALTER TABLE members ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"); } catch {}

// ---------------- crypto / senha ----------------
function hashPassword(password, salt = crypto.randomBytes(32)) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { hash, salt };
}
function verifyPassword(password, salt, expected) {
  try {
    const h = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    if (h.length !== expected.length) return false;
    return crypto.timingSafeEqual(h, expected);
  } catch { return false; }
}
function validPassword(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 128; // senha única da família
}
function getAuth() {
  return db.prepare("SELECT * FROM auth WHERE id=1").get() || null;
}
function setFamilyPassword(password) {
  const { hash, salt } = hashPassword(password);
  db.prepare("INSERT INTO auth(id,pass_hash,pass_salt,failed_attempts,locked_until,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pass_hash=excluded.pass_hash, pass_salt=excluded.pass_salt, failed_attempts=0, locked_until=0, updated_at=excluded.updated_at")
    .run(hash, salt, 0, 0, Date.now());
  db.prepare("DELETE FROM sessions").run(); // troca de senha derruba todas as sessões
}
function audit(ip, actor, event, detail = "") {
  try {
    db.prepare("INSERT INTO audit(at,ip,actor,event,detail) VALUES(?,?,?,?,?)").run(Date.now(), ip, actor, event, String(detail).slice(0, 500));
    const n = db.prepare("SELECT COUNT(*) c FROM audit").get().c;
    if (n > 5500) db.prepare("DELETE FROM audit WHERE id <= (SELECT MIN(id) + (? - 5000) FROM audit)").run(n);
  } catch {}
}

// ---------------- rate limit / lockout ----------------
// Anti-bruteforce em 3 camadas (a senha é o único segredo do app):
// 1) bucket por IP (token bucket) p/ /api/login
// 2) lockout progressivo global (5 erros -> 15min, dobra a cada 5)
// 3) atraso artificial + resposta genérica
const ipBuckets = new Map(); // ip -> {tokens, reset}
function ipAllowed(ip) {
  const now = Date.now();
  let b = ipBuckets.get(ip);
  if (!b || now > b.reset) { b = { tokens: 10, reset: now + 60_000 }; ipBuckets.set(ip, b); }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}
const generalBuckets = new Map();
function generalAllowed(ip, limit = 120) {
  const now = Date.now();
  let b = generalBuckets.get(ip);
  if (!b || now > b.reset) { b = { tokens: limit, reset: now + 60_000 }; generalBuckets.set(ip, b); }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of ipBuckets) if (n > v.reset) ipBuckets.delete(k); for (const [k, v] of generalBuckets) if (n > v.reset) generalBuckets.delete(k); }, 60_000).unref();

function lockoutRemaining(a) {
  return Math.max(0, ((a && a.locked_until) || 0) - Date.now());
}
function registerFailure(ip) {
  const a = getAuth();
  if (!a) return;
  const fails = (a.failed_attempts || 0) + 1;
  let locked = a.locked_until || 0;
  if (fails % 5 === 0) {
    const level = Math.floor(fails / 5);
    const mins = 15 * Math.pow(2, level - 1);
    locked = Date.now() + Math.min(mins, 24 * 60) * 60_000;
  }
  db.prepare("UPDATE auth SET failed_attempts=?, locked_until=? WHERE id=1").run(fails, locked);
  audit(ip, "familia", "login_fail", `tentativa ${fails}`);
}
function registerSuccess(ip) {
  db.prepare("UPDATE auth SET failed_attempts=0, locked_until=0 WHERE id=1").run();
  audit(ip, "familia", "login_ok", "");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- sessões / cookies ----------------
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(k)) out[k] = decodeURIComponent(v).slice(0, 512);
  }
  return out;
}
function isLoopback(req) {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
function clientIp(req) {
  if (TRUST_PROXY && isLoopback(req)) {
    const f = req.headers["x-forwarded-for"];
    if (typeof f === "string" && f.length) return f.split(",")[0].trim().slice(0, 64);
    const r = req.headers["cf-connecting-ip"];
    if (typeof r === "string" && r.length) return r.slice(0, 64);
  }
  return (req.socket.remoteAddress || "").slice(0, 64);
}
function isHttps(req) {
  if (TRUST_PROXY && isLoopback(req)) {
    const p = req.headers["x-forwarded-proto"];
    if (typeof p === "string" && p.split(",")[0].trim() === "https") return true;
    const cf = req.headers["cf-visitor"];
    if (typeof cf === "string" && cf.includes("https")) return true;
  }
  return false;
}
function setSessionCookie(res, sid, https) {
  const parts = [`sid=${sid}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (https) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
function getSession(req) {
  const { sid } = parseCookies(req);
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sid);
  if (!s) return null;
  if (s.expires_at < Date.now()) { try { db.prepare("DELETE FROM sessions WHERE id=?").run(sid); } catch {} return null; }
  return s;
}
function createSession(ip) {
  const sid = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO sessions(id,csrf,created_at,expires_at,ip) VALUES(?,?,?,?,?)").run(sid, csrf, now, now + SESSION_TTL_MS, ip);
  db.prepare("DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY created_at DESC LIMIT 20)").run();
  return { sid, csrf };
}
function needCsrf(req, session) {
  const t = req.headers["x-csrf-token"];
  if (typeof t !== "string" || !session) return false;
  const a = Buffer.from(t, "utf8"), b = Buffer.from(session.csrf, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------- helpers HTTP ----------------
function secHeaders(res, isHtml) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (isHtml) res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://shared.akamai.steamstatic.com https://cdn.akamai.steamstatic.com https://shared.fastly.steamstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  else res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}
function json(res, code, obj, req) {
  secHeaders(res, false);
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readJson(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    let tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      n += c.length;
      if (n > maxBytes) { tooBig = true; reject(Object.assign(new Error("payload grande"), { code: 413 })); }
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("JSON inválido"), { code: 400 })); }
    });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === "/") p = "/index.html";
  if (p.includes("\0") || p.includes("..")) { json(res, 400, { error: "bad path" }); return; }
  const file = path.join(PUBLIC_DIR, p.slice(1));
  if (!file.startsWith(PUBLIC_DIR)) { json(res, 400, { error: "bad path" }); return; }
  fs.readFile(file, (err, body) => {
    if (err) { secHeaders(res, false); res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    const ext = path.extname(file).toLowerCase();
    secHeaders(res, ext === ".html");
    // sem cache-busting manual: o build do frontend já gera nomes
    // com hash (assets/index-XXXX.js); HTML servido sempre fresco.
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable", "Content-Length": body.length });
    res.end(body);
  });
}

// ---------------- validação de domínio ----------------
function validDay(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(23, 59, 59, 999);
  return d <= today && d.getFullYear() >= 2003; // Steam existe desde 2003
}
function validYear(y) {
  const n = Number(y);
  return Number.isInteger(n) && n >= 2003 && n <= new Date().getFullYear() + 1 ? n : null;
}
function validMemberName(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ").slice(0, 40);
  return t.length >= 1 ? t : null;
}
/** Extrai o appid de um link da loja Steam ou de um número puro. Só /app/ é suportado. */
function parseSteamAppId(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).trim();
  if (/^\d{1,10}$/.test(s)) return parseInt(s, 10);
  const m = s.match(/store\.steampowered\.com\/app\/(\d{1,10})/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
function validPriceCents(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : null; // até R$ 100 mil
}
function validHttpUrl(s, max = 500) {
  if (!s) return "";
  if (typeof s !== "string" || s.length > max) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return s.slice(0, max);
  } catch { return null; }
}
function memberExists(id) {
  return !!db.prepare("SELECT 1 FROM members WHERE id=?").get(Number(id));
}
function avatarUrl(filename) {
  return filename ? `/avatars/${filename}` : "";
}

// ---------------- Steam API ----------------
// A API pública da Steam informa o preço ATUAL, não o histórico.
// Buscamos nome/capa/preço atual no cadastro e a família confirma o valor pago.
async function steamFetch(urlPath) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`https://store.steampowered.com${urlPath}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "FamiliaSteam/1.0" },
    });
    if (!r.ok) throw new Error(`steam http ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
async function steamAppDetails(appid) {
  const j = await steamFetch(`/api/appdetails?appids=${appid}&cc=BR&l=portuguese`);
  const entry = j && j[String(appid)];
  if (!entry || !entry.success || !entry.data) throw new Error("jogo não encontrado na Steam");
  const d = entry.data;
  const po = d.price_overview || null;
  return {
    appid,
    name: String(d.name || "").slice(0, 200),
    header_image: String(d.header_image || "").slice(0, 500),
    is_free: !!d.is_free,
    type: String(d.type || ""),
    current_price_cents: po && Number.isInteger(po.final) ? po.final : (d.is_free ? 0 : null),
    initial_price_cents: po && Number.isInteger(po.initial) ? po.initial : null,
    discount_pct: po && Number.isInteger(po.discount_percent) ? po.discount_percent : 0,
    currency: po ? String(po.currency || "BRL") : "BRL",
  };
}
const searchCache = new Map(); // termo -> {at, data}
async function steamSearchRaw(term, cc) {
  const path = cc
    ? `/api/storesearch/?term=${encodeURIComponent(term)}&l=portuguese&cc=${cc}`
    : `/api/storesearch/?term=${encodeURIComponent(term)}&l=portuguese`;
  const j = await steamFetch(path);
  return ((j && j.items) || [])
    .filter((i) => i && (i.type === "app" || i.type === "dlc" || i.type === "bundle" || i.type === "sub" || i.type === "package") && Number.isInteger(i.id))
    .slice(0, 10)
    .map((i) => ({
      appid: i.id,
      name: String(i.name || "").slice(0, 200),
      tiny_image: String(i.tiny_image || "").slice(0, 500),
      price_cents: i.price && Number.isInteger(i.price.final) ? i.price.final : null,
      is_free: !(i.price && Number.isInteger(i.price.final)),
    }));
}
async function steamSearch(term) {
  const key = term.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < STEAM_SEARCH_TTL_MS) return { results: hit.data, cached: true };
  // Batman: Arkham Collection só aparece com cc=BR; RE4 Remake só sem cc — tenta ambos e une.
  let results = await steamSearchRaw(term, "BR");
  try {
    const extra = await steamSearchRaw(term, null);
    const seen = new Set(results.map((r) => r.appid));
    for (const r of extra) if (!seen.has(r.appid)) results.push(r);
  } catch {}
  searchCache.set(key, { at: Date.now(), data: results });
  if (searchCache.size > 100) { const k = searchCache.keys().next().value; searchCache.delete(k); }
  return { results, cached: false };
}
function getCachedSteam(appid) {
  try {
    const c = db.prepare("SELECT * FROM steam_cache WHERE appid=?").get(appid);
    if (!c) return null;
    return { ...c, payload: JSON.parse(c.payload || "{}") };
  } catch { return null; }
}

// ---------------- avatares ----------------
const AVATAR_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_AVATAR_BYTES = 512 * 1024;
function validAvatarMagic(buf, mime) {
  if (mime === "image/png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/gif") { const s = buf.subarray(0, 6).toString("latin1"); return s === "GIF87a" || s === "GIF89a"; }
  if (mime === "image/webp") return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}
function saveAvatar(memberId, mime, b64) {
  if (!AVATAR_MIME[mime]) throw Object.assign(new Error("tipo de imagem não permitido (use jpg, png, webp ou gif)"), { code: 400 });
  let buf;
  try { buf = Buffer.from(String(b64 || ""), "base64"); } catch { throw Object.assign(new Error("imagem inválida"), { code: 400 }); }
  if (!buf.length || buf.length > MAX_AVATAR_BYTES) throw Object.assign(new Error("imagem deve ter até 500 KB (o app reduz sozinho no celular)"), { code: 400 });
  if (!validAvatarMagic(buf, mime)) throw Object.assign(new Error("o arquivo não é uma imagem válida"), { code: 400 });
  const stored = crypto.randomBytes(24).toString("hex") + AVATAR_MIME[mime];
  const cur = db.prepare("SELECT avatar FROM members WHERE id=?").get(memberId);
  if (!cur) throw Object.assign(new Error("membro não encontrado"), { code: 404 });
  fs.writeFileSync(path.join(AVATAR_DIR, stored), buf, { mode: 0o600 });
  db.prepare("UPDATE members SET avatar=? WHERE id=?").run(stored, memberId);
  if (cur.avatar) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(cur.avatar))); } catch {} }
  return stored;
}

// ---------------- estatísticas do ano ----------------
// Ranking no estilo "competição" (1,1,3…): empate mantém a posição e pula a seguinte.
function ranked(items, valueKey = "value") {
  let rank = 0, prev = Symbol("none");
  return items.map((e, i) => {
    if (e[valueKey] !== prev) { rank = i + 1; prev = e[valueKey]; }
    return { ...e, rank };
  });
}
const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");

function memberMeta() {
  const meta = {};
  try {
    for (const m of db.prepare("SELECT id, name, avatar FROM members").all()) {
      meta[m.id] = { name: m.name, avatar: avatarUrl(m.avatar) };
    }
  } catch {}
  return meta;
}

function statsForYear(year) {
  const y = String(year);
  const rows = db.prepare(`
    SELECT p.*, b.name AS buyer_name, g.name AS gift_to_name
    FROM purchases p
    JOIN members b ON b.id = p.buyer_member_id
    LEFT JOIN members g ON g.id = p.gift_to_member_id
    WHERE substr(p.purchase_date, 1, 4) = ?
    ORDER BY p.purchase_date ASC, p.id ASC`).all(y);
  if (!rows.length) {
    return { ready: false, year, message: "Nenhum jogo registrado neste ano. Toque em “+ Jogo”." };
  }
  const meta = memberMeta();
  const withAva = (e) => ({ ...e, avatar: (meta[e.member_id] || {}).avatar || "" });
  const splitRows = db.prepare(`
    SELECT ps.purchase_id, m.id AS member_id, m.name AS member_name
    FROM purchase_splits ps
    JOIN members m ON m.id = ps.member_id
    JOIN purchases p ON p.id = ps.purchase_id
    WHERE substr(p.purchase_date, 1, 4) = ?
    ORDER BY m.name ASC`).all(y);

  const splitsByPurchase = new Map();
  for (const s of splitRows) {
    if (!splitsByPurchase.has(s.purchase_id)) splitsByPurchase.set(s.purchase_id, []);
    splitsByPurchase.get(s.purchase_id).push(s.member_id);
  }
  // Participantes do rateio: comprador + marcados no racha (sem duplicar).
  const participantsOf = (r) => {
    const extra = splitsByPurchase.get(r.id) || [];
    return [...new Set([r.buyer_member_id, ...extra.filter((id) => id !== r.buyer_member_id)])];
  };
  // Divide o preço igualmente entre os participantes. A sobra de centavos
  // (ex: R$ 10,00 / 3 = 333 + 333 + 334) vai para os primeiros da lista,
  // com o comprador primeiro, para a soma das partes sempre fechar no total.
  const sharesOf = (r) => {
    const ids = participantsOf(r);
    const price = r.price_paid_cents || 0;
    const base = Math.floor(price / ids.length);
    let rest = price - base * ids.length;
    return ids.map((id) => {
      const extra = rest > 0 ? 1 : 0;
      if (rest > 0) rest -= 1;
      return { id, share: base + extra };
    });
  };
  const buyerShareOf = (r) => (sharesOf(r).find((s) => s.id === r.buyer_member_id) || { share: r.price_paid_cents || 0 }).share;

  const total = rows.length;
  const totalCents = rows.reduce((s, r) => s + (r.price_paid_cents || 0), 0);
  const freeCount = rows.filter((r) => (r.price_paid_cents || 0) === 0).length;

  // por mês (12 meses sempre, para "mais/menos" ser honesto)
  const perMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: MONTHS_PT[i], short: MONTHS_SHORT[i], count: 0, cents: 0 }));
  for (const r of rows) {
    const m = parseInt(r.purchase_date.slice(5, 7), 10);
    perMonth[m - 1].count += 1;
    perMonth[m - 1].cents += r.price_paid_cents || 0;
  }
  const maxC = Math.max(...perMonth.map((m) => m.count));
  const minC = Math.min(...perMonth.map((m) => m.count));
  const mostMonths = perMonth.filter((m) => m.count === maxC);
  const leastMonths = perMonth.filter((m) => m.count === minC);

  // ranking de compradores (quem registrou a compra).
  // Em jogos rachados, o comprador soma só a sua parte (preço / nº de participantes).
  // A contagem de jogos (value) continua integral para quem registrou.
  const byBuyer = new Map();
  for (const r of rows) {
    const e = byBuyer.get(r.buyer_member_id) || { member_id: r.buyer_member_id, name: r.buyer_name, value: 0, cents: 0, gifts: 0 };
    e.value += 1; e.cents += buyerShareOf(r);
    if (r.is_gift) e.gifts += 1;
    byBuyer.set(r.buyer_member_id, e);
  }

  // quem mais gastou (R$ no ano): TODOS os participantes somam sua parte.
  // Ex: jogo de R$ 100 rachado entre 2 = R$ 50 para cada; R$ 90 entre 3 = R$ 30 para cada.
  // A soma das partes sempre fecha no preço cheio (sobra de centavos vai para o comprador).
  const bySpender = new Map();
  for (const r of rows) {
    for (const s of sharesOf(r)) {
      const nm = s.id === r.buyer_member_id ? r.buyer_name : ((meta[s.id] || {}).name || "?");
      const p = bySpender.get(s.id) || { member_id: s.id, name: nm, value: 0, cents: 0, gifts: 0 };
      p.value += 1; p.cents += s.share;
      bySpender.set(s.id, p);
    }
  }
  const buyers = ranked([...byBuyer.values()].sort((a, b) => b.value - a.value || byName(a, b))).map((e) => withAva({ ...e, avgCents: Math.round(e.cents / e.value) }));

  // quem mais gastou (R$ no ano)
  const spenders = ranked([...bySpender.values()].sort((a, b) => b.cents - a.cents || byName(a, b)), "cents").map(withAva);

  // maiores presenteadores (quem registrou o presente) + valor da sua parte.
  // Só o comprador aparece aqui; demais participantes do racha somam em "quem mais gastou".
  const byGiver = new Map();
  for (const r of rows) {
    if (!r.is_gift) continue;
    const e = byGiver.get(r.buyer_member_id) || { member_id: r.buyer_member_id, name: r.buyer_name, value: 0, cents: 0 };
    e.value += 1;
    e.cents += buyerShareOf(r);
    byGiver.set(r.buyer_member_id, e);
  }
  const givers = ranked([...byGiver.values()].sort((a, b) => b.value - a.value || byName(a, b))).map(withAva);

  // presentes recebidos
  const byReceiver = new Map();
  for (const r of rows) {
    if (!r.is_gift || !r.gift_to_member_id) continue;
    const e = byReceiver.get(r.gift_to_member_id) || { member_id: r.gift_to_member_id, name: r.gift_to_name, value: 0, cents: 0 };
    e.value += 1; e.cents += r.price_paid_cents || 0;
    byReceiver.set(r.gift_to_member_id, e);
  }
  const receivers = ranked([...byReceiver.values()].sort((a, b) => b.value - a.value || byName(a, b))).map(withAva);

  // comprador compulsivo: maior nº de jogos comprados num único mês (por membro).
  // O valor do mês soma só a parte do comprador em jogos rachados.
  const perMemberMonth = new Map(); // `${memberId}-${MM}` -> {count, gifts, cents}
  for (const r of rows) {
    const k = `${r.buyer_member_id}-${r.purchase_date.slice(5, 7)}`;
    const e = perMemberMonth.get(k) || { member_id: r.buyer_member_id, name: r.buyer_name, month: parseInt(r.purchase_date.slice(5, 7), 10), count: 0, gifts: 0, cents: 0 };
    e.count += 1;
    e.cents += buyerShareOf(r);
    if (r.is_gift) e.gifts += 1;
    perMemberMonth.set(k, e);
  }
  const bestByMember = new Map();
  for (const e of perMemberMonth.values()) {
    const cur = bestByMember.get(e.member_id);
    if (!cur || e.count > cur.count || (e.count === cur.count && e.month < cur.month)) bestByMember.set(e.member_id, e);
  }
  const compulsive = ranked(
    [...bestByMember.values()]
      .map((e) => ({ member_id: e.member_id, name: e.name, value: e.count, month: e.month, monthLabel: MONTHS_PT[e.month - 1], gifts: e.gifts, cents: e.cents }))
      .sort((a, b) => b.value - a.value || byName(a, b))
  ).map(withAva);

  // racha = participação: quem comprou E quem entrou contam igual (sem dono/iniciante).
  // value = nº de rachas; cents = soma das partes pagas em rachas.
  const bySplit = new Map();
  for (const r of rows) {
    const shares = sharesOf(r);
    if (shares.length < 2) continue;
    for (const s of shares) {
      const nm = s.id === r.buyer_member_id ? r.buyer_name : ((meta[s.id] || {}).name || "?");
      const e = bySplit.get(s.id) || { member_id: s.id, name: nm, value: 0, cents: 0 };
      e.value += 1; e.cents += s.share;
      bySplit.set(s.id, e);
    }
  }
  const splits = ranked([...bySplit.values()].sort((a, b) => b.value - a.value || byName(a, b))).map(withAva);
  const splitCount = rows.filter((r) => participantsOf(r).length >= 2).length;

  // reis do mês: quem mais comprou em cada mês com movimento
  const monthlyKings = perMonth.filter((m) => m.count > 0).map((m) => {
    const mm = String(m.month).padStart(2, "0");
    const inMonth = rows.filter((r) => r.purchase_date.slice(5, 7) === mm);
    const counts = new Map();
    for (const r of inMonth) counts.set(r.buyer_member_id, (counts.get(r.buyer_member_id) || 0) + 1);
    const top = Math.max(...counts.values());
    const tops = [...counts.entries()].filter(([, c]) => c === top).map(([id]) => meta[id] || { name: "?", avatar: "" });
    tops.sort(byName);
    return { month: m.month, label: m.label, short: m.short, count: m.count, cents: m.cents, topCount: top, tops };
  });

  // top 5 jogos mais caros do ano
  const priciest = [...rows]
    .sort((a, b) => (b.price_paid_cents || 0) - (a.price_paid_cents || 0))
    .slice(0, 5)
    .map((r) => ({ id: r.id, game_name: r.game_name, header_image: r.header_image, cents: r.price_paid_cents || 0, buyer_name: r.buyer_name, buyer_avatar: (meta[r.buyer_member_id] || {}).avatar || "", purchase_date: r.purchase_date }));

  const out = {
    ready: true, year,
    total, totalCents, freeCount,
    avgCents: Math.round(totalCents / total),
    mostMonths: mostMonths.map((m) => ({ month: m.month, label: m.label, count: m.count })),
    leastMonths: leastMonths.map((m) => ({ month: m.month, label: m.label, count: m.count })),
    perMonth,
    buyers, spenders, givers, receivers, compulsive, splits,
    partners: splits, splitStarters: [], // compat: frontend antigo lia partners/splitStarters
    monthlyKings,
    giftCount: rows.filter((r) => r.is_gift).length,
    splitCount,
    priciest,
  };
  return out;
}

// enriquece compras com nomes, avatares + splits
function enrichPurchases(list) {
  if (!list.length) return [];
  const meta = memberMeta();
  const ids = list.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const srows = db.prepare(`
    SELECT ps.purchase_id, m.id AS member_id
    FROM purchase_splits ps JOIN members m ON m.id = ps.member_id
    WHERE ps.purchase_id IN (${ph})`).all(...ids);
  const byId = {};
  for (const s of srows) (byId[s.purchase_id] ||= []).push({ id: s.member_id, name: (meta[s.member_id] || {}).name || "", avatar: (meta[s.member_id] || {}).avatar || "" });
  return list.map((r) => ({
    ...r,
    buyer_avatar: (meta[r.buyer_member_id] || {}).avatar || "",
    gift_to_avatar: r.gift_to_member_id ? ((meta[r.gift_to_member_id] || {}).avatar || "") : "",
    splits: byId[r.id] || [],
  }));
}

// ---------------- router ----------------
async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const ip = clientIp(req);
  const method = req.method;

  if (!generalAllowed(ip)) { json(res, 429, { error: "muitas requisições, tente em 1 minuto" }, req); return; }

  // estáticos públicos (sem auth): frontend SPA em public/
  // (index.html + assets/ gerados pelo build do frontend-novo).
  // Rotas /api/* e /avatars/* tratadas abaixo; qualquer outro GET
  // sem extensão cai no index.html (fallback SPA).
  if (method === "GET" && !p.startsWith("/api/") && !p.startsWith("/avatars/")) {
    let target = p;
    if (target === "/") target = "/index.html";
    // fallback SPA: sem extensão e sem arquivo correspondente -> index.html
    if (!path.extname(target)) {
      const candidate = path.join(PUBLIC_DIR, target.slice(1));
      let isFile = false;
      try { isFile = fs.statSync(candidate).isFile(); } catch {}
      if (!isFile) target = "/index.html";
    }
    return serveStatic(req, res, target);
  }

  // health check público (p/ monitor/tunnel) — sem dados sensíveis
  if (p === "/api/health" && method === "GET") {
    secHeaders(res, false);
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": body.length });
    res.end(body);
    return;
  }

  // ---- login (senha única) ----
  if (p === "/api/login" && method === "POST") {
    if (!ipAllowed(ip)) { audit(ip, "familia", "login_ratelimit", ""); await sleep(800); return json(res, 429, { error: "muitas tentativas, aguarde 1 minuto" }, req); }
    let body; try { body = await readJson(req);     } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const password = String(body.password || "");
    const a = getAuth();
    await sleep(400); // custo constante: dificulta timing
    if (!a) return json(res, 503, { error: "senha ainda não configurada — rode: node server.js --set-password" }, req);
    if (lockoutRemaining(a) > 0) {
      const min = Math.ceil(lockoutRemaining(a) / 60000);
      audit(ip, "familia", "login_locked", `${min}min`);
      return json(res, 423, { error: `muitas tentativas erradas — tente em ~${min} min` }, req);
    }
    if (!verifyPassword(password, a.pass_salt, a.pass_hash)) {
      registerFailure(ip);
      const a2 = getAuth();
      if (lockoutRemaining(a2) > 0) return json(res, 423, { error: "muitas tentativas erradas — acesso bloqueado temporariamente" }, req);
      return json(res, 401, { error: "senha incorreta" }, req);
    }
    registerSuccess(ip);
    const { sid, csrf } = createSession(ip);
    setSessionCookie(res, sid, isHttps(req));
    return json(res, 200, { ok: true, csrf }, req);
  }

  // sessão necessária daqui em diante
  const sess = getSession(req);
  if (p === "/api/logout" && method === "POST") {
    if (sess) { try { db.prepare("DELETE FROM sessions WHERE id=?").run(parseCookies(req).sid); } catch {} }
    clearCookie(res);
    return json(res, 200, { ok: true }, req);
  }
  if (!sess) return json(res, 401, { error: "não autenticado" }, req);
  try { db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run(Date.now() + SESSION_TTL_MS, parseCookies(req).sid); } catch {}

  if (p === "/api/me" && method === "GET") {
    return json(res, 200, { ok: true, csrf: sess.csrf }, req);
  }

  // mutações exigem CSRF (exceto GET/HEAD)
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !needCsrf(req, sess)) {
    audit(ip, "familia", "csrf_fail", p);
    return json(res, 403, { error: "token CSRF inválido" }, req);
  }

  // ---- trocar a senha da família ----
  if (p === "/api/password" && method === "POST") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const a = getAuth();
    if (!verifyPassword(String(body.current || ""), a.pass_salt, a.pass_hash)) {
      audit(ip, "familia", "password_fail", "");
      return json(res, 401, { error: "senha atual incorreta" }, req);
    }
    if (!validPassword(String(body.new || ""))) return json(res, 400, { error: "nova senha: mínimo 8 caracteres (máx 128)" }, req);
    const { hash: nh, salt: ns } = hashPassword(String(body.new));
    db.prepare("UPDATE auth SET pass_hash=?, pass_salt=?, failed_attempts=0, locked_until=0, updated_at=? WHERE id=1").run(nh, ns, Date.now());
    audit(ip, "familia", "password_change", "");
    // derruba as OUTRAS sessões, mantém a atual
    const mySid = parseCookies(req).sid;
    try { db.prepare("DELETE FROM sessions WHERE id != ?").run(mySid); } catch {}
    return json(res, 200, { ok: true, csrf: sess.csrf }, req);
  }

  // ---- membros da família ----
  if (p === "/api/members" && method === "GET") {
    const members = db.prepare(`
      SELECT m.id, m.name, m.avatar,
        (SELECT COUNT(*) FROM purchases WHERE buyer_member_id = m.id) AS bought,
        (SELECT COUNT(*) FROM purchases WHERE is_gift = 1 AND buyer_member_id = m.id) AS gifted,
        (SELECT COUNT(*) FROM purchases p WHERE p.buyer_member_id = m.id AND EXISTS (SELECT 1 FROM purchase_splits ps WHERE ps.purchase_id = p.id)) +
        (SELECT COUNT(*) FROM purchase_splits WHERE member_id = m.id) AS split_in
      FROM members m ORDER BY m.name COLLATE NOCASE ASC`).all()
      .map((m) => ({ ...m, avatar_url: avatarUrl(m.avatar) }));
    return json(res, 200, { members }, req);
  }
  if (p === "/api/members" && method === "POST") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const name = validMemberName(body.name);
    if (!name) return json(res, 400, { error: "nome inválido (1–40 caracteres)" }, req);
    try {
      const r = db.prepare("INSERT INTO members(name,created_at) VALUES(?,?)").run(name, Date.now());
      audit(ip, "familia", "member_create", name);
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid) }, req);
    } catch { return json(res, 409, { error: "esse nome já existe" }, req); }
  }
  let m;
  if ((m = p.match(/^\/api\/members\/(\d+)$/)) && method === "PUT") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const name = validMemberName(body.name);
    if (!name) return json(res, 400, { error: "nome inválido (1–40 caracteres)" }, req);
    try {
      const r = db.prepare("UPDATE members SET name=? WHERE id=?").run(name, Number(m[1]));
      if (r.changes === 0) return json(res, 404, { error: "não encontrado" }, req);
    } catch { return json(res, 409, { error: "esse nome já existe" }, req); }
    audit(ip, "familia", "member_rename", `id=${m[1]} -> ${name}`);
    return json(res, 200, { ok: true }, req);
  }
  if ((m = p.match(/^\/api\/members\/(\d+)$/)) && method === "DELETE") {
    const id = Number(m[1]);
    const refs = db.prepare("SELECT (SELECT COUNT(*) FROM purchases WHERE buyer_member_id=?) + (SELECT COUNT(*) FROM purchases WHERE gift_to_member_id=?) + (SELECT COUNT(*) FROM purchase_splits WHERE member_id=?) AS c").get(id, id, id).c;
    if (refs > 0) return json(res, 409, { error: `membro tem ${refs} vínculo(s) com jogos — edite os jogos antes de excluir` }, req);
    const cur = db.prepare("SELECT avatar FROM members WHERE id=?").get(id);
    const r = db.prepare("DELETE FROM members WHERE id=?").run(id);
    if (r.changes === 0) return json(res, 404, { error: "não encontrado" }, req);
    if (cur && cur.avatar) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(cur.avatar))); } catch {} }
    audit(ip, "familia", "member_delete", `id=${id}`);
    return json(res, 200, { ok: true }, req);
  }
  // foto de perfil do membro (base64 via JSON; o app reduz no celular antes de enviar)
  if ((m = p.match(/^\/api\/members\/(\d+)\/avatar$/)) && method === "POST") {
    let body; try { body = await readJson(req, 1024 * 1024); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    try {
      const stored = saveAvatar(Number(m[1]), String(body.mime || ""), String(body.data || ""));
      audit(ip, "familia", "member_avatar", `id=${m[1]}`);
      return json(res, 201, { ok: true, avatar_url: avatarUrl(stored) }, req);
    } catch (e) { return json(res, e.code === 400 || e.code === 404 ? e.code : 400, { error: e.message }, req); }
  }
  if ((m = p.match(/^\/api\/members\/(\d+)\/avatar$/)) && method === "DELETE") {
    const id = Number(m[1]);
    const cur = db.prepare("SELECT avatar FROM members WHERE id=?").get(id);
    if (!cur) return json(res, 404, { error: "não encontrado" }, req);
    if (cur.avatar) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(cur.avatar))); } catch {} }
    db.prepare("UPDATE members SET avatar='' WHERE id=?").run(id);
    audit(ip, "familia", "member_avatar_del", `id=${id}`);
    return json(res, 200, { ok: true }, req);
  }
  // servir avatar (só logado — toda a família)
  if ((m = p.match(/^\/avatars\/([a-f0-9]{48}\.(?:jpg|png|webp|gif))$/)) && method === "GET") {
    const stored = m[1];
    const ok = db.prepare("SELECT 1 FROM members WHERE avatar=?").get(stored);
    if (!ok) { secHeaders(res, false); res.writeHead(404); res.end(); return; }
    const fp = path.join(AVATAR_DIR, path.basename(stored));
    const ext = path.extname(stored).toLowerCase();
    const ctype = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" }[ext] || "application/octet-stream";
    fs.readFile(fp, (err, data) => {
      if (err) { secHeaders(res, false); res.writeHead(404); res.end(); return; }
      secHeaders(res, false);
      res.writeHead(200, { "Content-Type": ctype, "Cache-Control": "private, max-age=86400", "Content-Length": data.length });
      res.end(data);
    });
    return;
  }

  // ---- busca de jogos por nome (Steam storesearch) ----
  if (p === "/api/steam/search" && method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);
    if (q.length < 2) return json(res, 400, { error: "digite ao menos 2 letras para buscar" }, req);
    try {
      const { results, cached } = await steamSearch(q);
      return json(res, 200, { results, cached }, req);
    } catch (e) {
      return json(res, 502, { error: `não foi possível buscar na Steam agora (${e.message}). Tente pelo link.` }, req);
    }
  }

  // ---- lookup na Steam por link/appid (nome/capa/preço ATUAL) ----
  if (p === "/api/steam/lookup" && method === "GET") {
    const appid = parseSteamAppId(url.searchParams.get("url") || url.searchParams.get("appid") || "");
    if (!appid) return json(res, 400, { error: "link inválido — use um link store.steampowered.com/app/ID/ ou o número do app" }, req);
    const cached = getCachedSteam(appid);
    if (cached && Date.now() - cached.updated_at < STEAM_CACHE_TTL_MS) {
      return json(res, 200, { ...cached.payload, appid, cached: true }, req);
    }
    try {
      const info = await steamAppDetails(appid);
      db.prepare("INSERT INTO steam_cache(appid,name,header_image,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(appid) DO UPDATE SET name=excluded.name, header_image=excluded.header_image, payload=excluded.payload, updated_at=excluded.updated_at")
        .run(appid, info.name, info.header_image, JSON.stringify(info), Date.now());
      return json(res, 200, { ...info, cached: false }, req);
    } catch (e) {
      if (cached) return json(res, 200, { ...cached.payload, appid, cached: true, stale: true }, req);
      return json(res, 502, { error: `não foi possível consultar a Steam agora (${e.message}). Preencha nome e preço manualmente.` }, req);
    }
  }

  // ---- enriquecer compras importadas: busca capa+appid na Steam p/ quem está sem capa ----
  // Só salva URL da capa + appid + steam_url no banco (nada de imagem local).
  // Preço: a Steam informa só o ATUAL — puxar retroativamente daria valor errado,
  // por isso price_paid_cents NÃO é alterado aqui (só via edição manual no app).
  //
  // ESTRATÉGIA DE MATCHING (bundles/DLCs costumam ser "sub"/"bundle"/"dlc", não "app"):
  // 1) storesearch com o nome cheio, aceitando app|sub|bundle|dlc
  // 2) storesearch progressivo: remove sufixo após " - ", " + ", ":", " (" (edições especiais)
  // 3) correções de typos/nomes da planilha antiga (nome errado -> termo que a Steam entende)
  // 4) tenta cada candidato no appdetails até um com capa válida (subs não têm appdetails)
  // 5) fallback final: capa do jogo base via appdetails direto (bundles só têm o appid do pacote)
  const TYPO_FIX = [
    [/scribblenauts/i, "Scribblenauts Unlimited"],
    [/resident evil 4 remake/i, "Resident Evil 4"],
    [/vilage/i, "Resident Evil Village"],
    [/rythm/i, "Super Crazy Rhythm Castle"],
    [/strading/i, "Death Stranding"],
    [/god of war 2018/i, "God of War"],
    [/monster hunter stories collection/i, "Monster Hunter Stories"],
    [/twin pack/i, "FINAL FANTASY VII REMAKE"],
    [/dangaronpa/i, "Danganronpa"],
    [/nightrein\b/i, "ELDEN RING Nightreign"],
    [/charlier/i, "Charlie Murder"],
    [/attourney/i, "Ace Attorney"],
    [/valkirye/i, "Valkyrie Drive Bhikkhuni"],
    [/fireboy e wartergirl/i, "Fireboy Watergirl"],
    [/titãs da maré/i, "SpongeBob SquarePants Titans of the Tide"],
    [/wolfestein/i, "Wolfenstein"],
    [/beyond two souls/i, "Beyond Two Souls"],
    [/caps & cups/i, "Caps Cups"],
    [/uma musume/i, "Uma Musume Pretty Derby"],
  ];
  // bundle/pacote (sem appdetails) -> appid do jogo base p/ capa
  const BUNDLE_BASE_APP = [
    [/batman: arkham collection/i, 35140], // Batman: Arkham Asylum GOTY (capa da série)
    [/one piece pirate warriors 4 deluxe/i, 1089090], // ONE PIECE: PIRATE WARRIORS 4
    [/kingdom come: deliverance royal/i, 379430], // Kingdom Come: Deliverance
    [/darksiders ultimate/i, 462780], // Darksiders Warmastered
    [/mortal kombat xl/i, 976310], // Mortal Kombat 11 (série; XL delistado)
    [/final fantasy xvi complete/i, 2515020], // FINAL FANTASY XVI
    [/planet zoo deluxe/i, 703080], // Planet Zoo
    [/borderlands goty/i, 8980], // Borderlands GOTY
    [/thief simulator.*luxury/i, 704850], // Thief Simulator
    [/car mechanic simulator/i, 1190000], // Car Mechanic Simulator 2021
    [/transport fever 2 deluxe/i, 1066780], // Transport Fever 2
  ];
  async function enrichOne(gameName) {
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const want = norm(gameName);
    const variants = [gameName];
    for (const [re, fix] of TYPO_FIX) {
      if (re.test(gameName)) { variants.push(fix); break; }
    }
    for (const sep of [" - ", " + ", ":", " (", " – "]) {
      const cut = gameName.split(sep)[0].trim();
      if (cut && cut.length >= 3 && !variants.includes(cut)) variants.push(cut);
    }
    let candidates = [];
    for (const v of variants) {
      const { results } = await steamSearch(v);
      if (results && results.length) { candidates = results; break; }
    }
    // fallback ANTES do erro: bundle/pacote conhecido -> capa do jogo base
    if (!candidates.length) {
      for (const [re, baseApp] of BUNDLE_BASE_APP) {
        if (re.test(gameName)) {
          const info = await steamAppDetails(baseApp);
          return { info, matched: info.name + " (jogo base)" };
        }
      }
      throw new Error("não encontrado na Steam");
    }
    let best = candidates[0];
    for (const r of candidates) {
      const rn = norm(r.name);
      if (rn === want || rn.startsWith(want) || want.startsWith(rn)) { best = r; break; }
    }
    // subs/bundles não têm appdetails (success=false) — tenta cada candidato até um com capa válida
    let info = null, matched = best.name;
    for (const cand of [best, ...candidates.filter((c) => c.appid !== best.appid)]) {
      try {
        info = await steamAppDetails(cand.appid);
        matched = cand.name;
        break;
      } catch { /* tenta o próximo candidato */ }
    }
    if (!info) {
      // fallback: bundle/pacote conhecido -> capa do jogo base
      for (const [re, baseApp] of BUNDLE_BASE_APP) {
        if (re.test(gameName)) {
          info = await steamAppDetails(baseApp);
          matched = info.name + " (jogo base)";
          break;
        }
      }
    }
    if (!info) throw new Error("sem capa válida na Steam (só bundle/pacote)");
    return { info, matched };
  }
  if (p === "/api/steam/enrich" && method === "POST") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 10));
    const targets = db.prepare("SELECT id, game_name FROM purchases WHERE (header_image = '' OR header_image IS NULL) AND game_name != '' ORDER BY id ASC LIMIT ?").all(limit);
    const out = [];
    for (const t of targets) {
      try {
        const { info, matched } = await enrichOne(t.game_name);
        db.prepare("UPDATE purchases SET appid=?, header_image=?, steam_url=?, updated_at=? WHERE id=?")
          .run(info.appid, info.header_image, `https://store.steampowered.com/app/${info.appid}/`, Date.now(), t.id);
        db.prepare("INSERT INTO steam_cache(appid,name,header_image,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(appid) DO UPDATE SET name=excluded.name, header_image=excluded.header_image, payload=excluded.payload, updated_at=excluded.updated_at")
          .run(info.appid, info.name, info.header_image, JSON.stringify(info), Date.now());
        audit(ip, "familia", "steam_enrich", `${t.game_name} -> appid ${info.appid} (${info.name})`);
        out.push({ id: t.id, game_name: t.game_name, ok: true, appid: info.appid, steam_name: info.name, matched_via: matched, current_price_cents: info.current_price_cents });
        await new Promise((r) => setTimeout(r, 1200)); // respeita o rate-limit da Steam
      } catch (e) {
        out.push({ id: t.id, game_name: t.game_name, ok: false, error: String(e.message || e).slice(0, 120) });
      }
    }
    const rest = db.prepare("SELECT COUNT(*) c FROM purchases WHERE (header_image = '' OR header_image IS NULL)").get().c;
    return json(res, 200, { ok: true, done: out, remaining: rest }, req);
  }

  // ---- preencher preços atuais (HOJE) nos jogos com preço zerado ----
  // Usa appid já resolvido no banco; só consulta appdetails (1 chamada por jogo, sem busca).
  // Marca price_source='steam-atual' + nota "Preço atual (Steam, <data>)" — edite se souber o valor pago.
  if (p === "/api/steam/fill-prices" && method === "POST") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
    const targets = db.prepare("SELECT id, game_name, appid FROM purchases WHERE price_paid_cents = 0 AND appid > 0 ORDER BY id ASC LIMIT ?").all(limit);
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const t of targets) {
      try {
        const info = await steamAppDetails(t.appid);
        db.prepare("INSERT INTO steam_cache(appid,name,header_image,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(appid) DO UPDATE SET name=excluded.name, header_image=excluded.header_image, payload=excluded.payload, updated_at=excluded.updated_at")
          .run(t.appid, info.name, info.header_image, JSON.stringify(info), Date.now());
        if (info.current_price_cents === null || info.current_price_cents === undefined) {
          out.push({ id: t.id, game_name: t.game_name, ok: false, error: "Steam não informou preço atual" });
          continue;
        }
        const cur = db.prepare("SELECT note FROM purchases WHERE id=?").get(t.id);
        const tag = `Preço atual (Steam, ${today})`;
        const note = cur.note && cur.note.includes("Preço atual (Steam,") ? cur.note : ((cur.note ? cur.note + " · " : "") + tag).slice(0, 500);
        db.prepare("UPDATE purchases SET price_paid_cents=?, price_source='steam-atual', note=?, updated_at=? WHERE id=?")
          .run(info.current_price_cents, note, Date.now(), t.id);
        audit(ip, "familia", "steam_fill_price", `${t.game_name} -> ${info.current_price_cents}c (atual ${today})`);
        out.push({ id: t.id, game_name: t.game_name, ok: true, price_cents: info.current_price_cents, free: info.current_price_cents === 0 });
        await new Promise((r) => setTimeout(r, 1200)); // respeita o rate-limit da Steam
      } catch (e) {
        out.push({ id: t.id, game_name: t.game_name, ok: false, error: String(e.message || e).slice(0, 120) });
      }
    }
    const rest = db.prepare("SELECT COUNT(*) c FROM purchases WHERE price_paid_cents = 0").get().c;
    return json(res, 200, { ok: true, done: out, remaining: rest, date: today }, req);
  }

  // ---- anos com dados ----
  if (p === "/api/years" && method === "GET") {
    const rows = db.prepare("SELECT DISTINCT substr(purchase_date,1,4) AS y FROM purchases ORDER BY y DESC").all();
    const years = rows.map((r) => Number(r.y));
    const cur = new Date().getFullYear();
    if (!years.includes(cur)) years.unshift(cur);
    return json(res, 200, { years }, req);
  }

  // ---- compras ----
  if (p === "/api/purchases" && method === "GET") {
    const y = url.searchParams.get("year");
    const memberQ = url.searchParams.get("member");
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const conds = [], args = [];
    if (y && validYear(y)) { conds.push("substr(p.purchase_date,1,4) = ?"); args.push(String(y)); }
    if (memberQ && /^\d+$/.test(memberQ)) { conds.push("p.buyer_member_id = ?"); args.push(Number(memberQ)); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    let list = db.prepare(`
      SELECT p.*, b.name AS buyer_name, g.name AS gift_to_name
      FROM purchases p
      JOIN members b ON b.id = p.buyer_member_id
      LEFT JOIN members g ON g.id = p.gift_to_member_id
      ${where} ORDER BY p.purchase_date DESC, p.id DESC LIMIT 1000`).all(...args);
    list = enrichPurchases(list);
    if (q) {
      list = list.filter((r) => `${r.game_name} ${r.buyer_name} ${r.gift_to_name || ""} ${(r.splits || []).map((s) => s.name).join(" ")} ${r.note || ""}`.toLowerCase().includes(q));
    }
    return json(res, 200, { purchases: list }, req);
  }

  function parsePurchaseBody(body) {
    // Cadastro manual permitido: sem link da Steam, appid fica 0.
    // Colunas Coleção/DLC da planilha antiga não existem no app — vão para a nota.
    const appid = parseSteamAppId(body.appid ?? body.steam_url ?? "") || 0;
    const game_name = String(body.game_name || "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (!game_name) return { error: "nome do jogo é obrigatório" };
    const header_image = validHttpUrl(body.header_image || "", 500);
    if (header_image === null) return { error: "URL da capa inválida" };
    let steam_url = validHttpUrl(body.steam_url || "", 500);
    if (steam_url === null) return { error: "link da Steam inválido" };
    if (!steam_url && appid) steam_url = `https://store.steampowered.com/app/${appid}/`;
    const buyer_member_id = Number(body.buyer_member_id);
    if (!Number.isInteger(buyer_member_id) || !memberExists(buyer_member_id)) return { error: "escolha quem comprou" };
    const purchase_date = String(body.purchase_date || "");
    if (!validDay(purchase_date)) return { error: "data da compra inválida (use datas até hoje)" };
    const price_paid_cents = validPriceCents(body.price_paid_cents);
    if (price_paid_cents === null) return { error: "preço inválido" };
    const price_source = body.price_source === "steam-atual" ? "steam-atual" : "manual";
    const is_gift = body.is_gift === true || body.is_gift === 1 ? 1 : 0;
    let gift_to_member_id = null;
    if (is_gift) {
      gift_to_member_id = Number(body.gift_to_member_id);
      if (!Number.isInteger(gift_to_member_id) || !memberExists(gift_to_member_id)) return { error: "escolha para quem foi o presente" };
      if (gift_to_member_id === buyer_member_id) return { error: "presente não pode ser para o próprio comprador" };
    }
    let split_with = [];
    if (Array.isArray(body.split_with)) {
      split_with = [...new Set(body.split_with.map(Number).filter((n) => Number.isInteger(n)))];
      if (split_with.includes(buyer_member_id)) return { error: "o comprador já conta no racha — marque só os outros" };
      if (split_with.length > 20) return { error: "rachas com no máximo 20 pessoas" };
      for (const id of split_with) if (!memberExists(id)) return { error: "membro do racha não existe" };
    }
    const note = String(body.note || "").slice(0, 500);
    return { appid, game_name, header_image, steam_url, buyer_member_id, purchase_date, price_paid_cents, price_source, is_gift, gift_to_member_id, split_with, note };
  }

  if (p === "/api/purchases" && method === "POST") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    if (db.prepare("SELECT COUNT(*) c FROM members").get().c === 0) {
      return json(res, 400, { error: "cadastre os membros da família primeiro (aba Membros)" }, req);
    }
    const v = parsePurchaseBody(body);
    if (v.error) return json(res, 400, { error: v.error }, req);
    const now = Date.now();
    const r = db.prepare(`
      INSERT INTO purchases(appid,game_name,header_image,steam_url,buyer_member_id,purchase_date,price_paid_cents,price_source,is_gift,gift_to_member_id,note,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.appid, v.game_name, v.header_image, v.steam_url, v.buyer_member_id, v.purchase_date, v.price_paid_cents, v.price_source, v.is_gift, v.gift_to_member_id, v.note, now, now);
    const pid = Number(r.lastInsertRowid);
    for (const mid of v.split_with) db.prepare("INSERT INTO purchase_splits(purchase_id,member_id) VALUES(?,?)").run(pid, mid);
    audit(ip, "familia", "purchase_create", `${v.game_name} (${v.purchase_date})`);
    return json(res, 201, { ok: true, id: pid }, req);
  }
  if ((m = p.match(/^\/api\/purchases\/(\d+)$/)) && method === "PUT") {
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }, req); }
    const id = Number(m[1]);
    if (!db.prepare("SELECT 1 FROM purchases WHERE id=?").get(id)) return json(res, 404, { error: "não encontrado" }, req);
    const v = parsePurchaseBody(body);
    if (v.error) return json(res, 400, { error: v.error }, req);
    db.prepare(`
      UPDATE purchases SET appid=?, game_name=?, header_image=?, steam_url=?, buyer_member_id=?, purchase_date=?, price_paid_cents=?, price_source=?, is_gift=?, gift_to_member_id=?, note=?, updated_at=? WHERE id=?`)
      .run(v.appid, v.game_name, v.header_image, v.steam_url, v.buyer_member_id, v.purchase_date, v.price_paid_cents, v.price_source, v.is_gift, v.gift_to_member_id, v.note, Date.now(), id);
    db.prepare("DELETE FROM purchase_splits WHERE purchase_id=?").run(id);
    for (const mid of v.split_with) db.prepare("INSERT INTO purchase_splits(purchase_id,member_id) VALUES(?,?)").run(id, mid);
    audit(ip, "familia", "purchase_update", `id=${id} ${v.game_name}`);
    return json(res, 200, { ok: true }, req);
  }
  if ((m = p.match(/^\/api\/purchases\/(\d+)$/)) && method === "DELETE") {
    const r = db.prepare("DELETE FROM purchases WHERE id=?").run(Number(m[1]));
    if (r.changes === 0) return json(res, 404, { error: "não encontrado" }, req);
    audit(ip, "familia", "purchase_delete", `id=${m[1]}`);
    return json(res, 200, { ok: true }, req);
  }

  // ---- retrospectiva do ano ----
  if (p === "/api/stats" && method === "GET") {
    const y = validYear(url.searchParams.get("year") || new Date().getFullYear());
    if (!y) return json(res, 400, { error: "ano inválido" }, req);
    return json(res, 200, statsForYear(y), req);
  }

  // ---- export CSV ----
  if (p === "/api/export.csv" && method === "GET") {
    const y = validYear(url.searchParams.get("year") || new Date().getFullYear());
    if (!y) return json(res, 400, { error: "ano inválido" }, req);
    const list = enrichPurchases(db.prepare(`
      SELECT p.*, b.name AS buyer_name, g.name AS gift_to_name
      FROM purchases p
      JOIN members b ON b.id = p.buyer_member_id
      LEFT JOIN members g ON g.id = p.gift_to_member_id
      WHERE substr(p.purchase_date,1,4) = ? ORDER BY p.purchase_date ASC, p.id ASC`).all(String(y)));
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["data,jogo,appid,comprador,preco_centavos,preco_brl,presente,presenteado,rachado_com,link,nota"];
    for (const r of list) {
      const splitNames = (r.splits || []).map((s) => s.name).join(";");
      lines.push([r.purchase_date, q(r.game_name), r.appid, q(r.buyer_name), r.price_paid_cents || 0, ((r.price_paid_cents || 0) / 100).toFixed(2), r.is_gift ? "sim" : "não", q(r.gift_to_name || ""), q(splitNames), r.steam_url, q(r.note)].join(","));
    }
    const body = "\uFEFF" + lines.join("\n");
    secHeaders(res, false);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=familia-steam-${y}.csv`, "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  return json(res, 404, { error: "não encontrado" }, req);
}

const server = http.createServer((req, res) => handler(req, res).catch((e) => {
  try { json(res, 500, { error: "erro interno" }, req); } catch {}
}));

// ---------------- senha inicial ----------------
function ensurePassword() {
  const has = !!getAuth();
  const envPass = process.env.PASSWORD || process.env.ADMIN_PASSWORD || process.env.FAMILY_PASSWORD;
  const wantsSet = process.argv.includes("--set-password") || process.argv.includes("--init-admin");
  if (wantsSet) {
    let password = envPass;
    if (!password) { password = genPassword(); console.log("\n=============================================="); console.log(`  Senha da família:  ${password}`); console.log("  Compartilhe com todos. Guarde em local seguro."); console.log("==============================================\n"); }
    if (!validPassword(password)) { console.error("Senha inválida: mínimo 8 caracteres (máx 128). Use env PASSWORD."); process.exit(1); }
    setFamilyPassword(password);
    console.log(has ? "Senha da família atualizada (todas as sessões foram derrubadas)." : "Senha da família definida.");
    process.exit(0);
  }
  if (!has) {
    if (envPass) {
      if (!validPassword(envPass)) { console.error("PASSWORD inválido: mínimo 8 caracteres"); process.exit(1); }
      setFamilyPassword(envPass);
      console.log("Senha da família definida via env PASSWORD.");
    } else {
      console.log("\nNenhuma senha definida. Rode:  node server.js --set-password");
      console.log("Ou defina env PASSWORD e reinicie.\n");
    }
  }
}
ensurePassword();

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function pickFreePort(preferred) {
  const start = preferred || 3001;
  for (let p = start; p < start + 500; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) return p;
  }
  throw new Error("nenhuma porta livre encontrada");
}
function serviceInfo() {
  let pid = null, port = null;
  try { pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10) || null; } catch {}
  try { port = parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10) || null; } catch {}
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
  return { pid, port, alive };
}
function genPassword() {
  // 12 chars, letras+números (sem ambíguos)
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const rnd = crypto.randomBytes(24);
  for (let i = 0; i < 12; i++) s += abc[rnd[i] % abc.length];
  return s;
}
async function cmdDaemon(argPort) {
  const cur = serviceInfo();
  if (cur.alive) {
    console.log(`Serviço já rodando: pid=${cur.pid} porta=${cur.port} (http://127.0.0.1:${cur.port})`);
    process.exit(0);
  }
  const envBind = process.env.BIND || "127.0.0.1";
  const port = await pickFreePort(argPort ? parseInt(argPort, 10) : (process.env.PORT ? parseInt(process.env.PORT, 10) : 0) || 0);
  // garante senha quando o banco está vazio (sem ela ninguém entra)
  let freshCreds = null;
  if (!getAuth()) {
    const password = process.env.PASSWORD || process.env.ADMIN_PASSWORD || genPassword();
    setFamilyPassword(password);
    freshCreds = password;
  }
  db.close();
  const log = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(port), BIND: envBind },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  fs.writeFileSync(PORT_FILE, String(port));
  fs.writeFileSync(path.join(DATA_DIR, "service.bind"), envBind);
  const t0 = Date.now();
  let up = false;
  const probeHost = envBind === "0.0.0.0" ? "127.0.0.1" : envBind;
  while (Date.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await new Promise((resolve, reject) => {
        const rq = http.get({ host: probeHost, port, path: "/", timeout: 1500 }, (rs) => { rs.resume(); rs.on("end", resolve); });
        rq.on("error", reject); rq.on("timeout", () => { rq.destroy(); reject(new Error("t")); });
      });
      up = true; break;
    } catch {}
  }
  console.log("\n==============================================");
  console.log(`  Família Steam rodando como serviço (pid ${child.pid})`);
  console.log(`  URL local:  http://${envBind}:${port}`);
  console.log(`  Cloudflare Tunnel →  http://${envBind === "0.0.0.0" ? "127.0.0.1" : envBind}:${port}  (use http, NÃO https)`);
  if (freshCreds) {
    console.log(`  Senha da família:   ${freshCreds}`);
    console.log("  Compartilhe com todos.");
  } else {
    console.log("  Senha: use a senha já definida (banco já tinha senha).");
  }
  console.log(`  Log: ${LOG_FILE} · status: node server.js --status`);
  console.log("==============================================\n");
  if (!up) { console.error("AVISO: serviço iniciado mas não respondeu em 15s — veja o log."); process.exit(1); }
  process.exit(0);
}
function cmdStatus() {
  const { pid, port, alive } = serviceInfo();
  let bind = "127.0.0.1";
  try { bind = fs.readFileSync(path.join(DATA_DIR, "service.bind"), "utf8").trim() || bind; } catch {}
  if (!port && !pid) { console.log("Serviço nunca iniciado (sem service.pid/service.port em data/)."); return; }
  console.log(alive ? `Rodando: pid=${pid} em http://${bind}:${port}` : `Parado (último pid=${pid} em ${bind}:${port}). Suba com: node server.js --daemon`);
}
function cmdStop() {
  const { pid, alive } = serviceInfo();
  if (!alive || !pid) { console.log("Serviço não está rodando."); try { fs.unlinkSync(PID_FILE); } catch {} return; }
  try { process.kill(pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(pid, 0); try { process.kill(pid, "SIGKILL"); } catch {} } catch {} }, 2500).unref?.();
  try { fs.unlinkSync(PID_FILE); } catch {}
  console.log(`Sinal de parada enviado ao pid ${pid}.`);
}
const _args = process.argv.slice(2);
if (_args.includes("--status")) { cmdStatus(); process.exit(0); }
if (_args.includes("--stop")) { cmdStop(); process.exit(0); }
if (_args.includes("--daemon") || _args.includes("--service")) {
  const i = Math.max(_args.indexOf("--daemon"), _args.indexOf("--service"));
  const portArg = _args[i + 1] && /^\d+$/.test(_args[i + 1]) ? _args[i + 1] : null;
  await cmdDaemon(portArg);
}

server.listen(PORT, BIND, () => {
  try { fs.writeFileSync(PORT_FILE, String(PORT)); } catch {}
  console.log(`Família Steam em http://${BIND}:${PORT}  (exponha via Cloudflare Tunnel, veja tunnel.md)`);
});

// encerra limpo no SIGTERM/SIGINT (checkpoint do WAL, sem corromper o banco)
let _closing = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (_closing) return;
    _closing = true;
    try { server.close(); } catch {}
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { db.close(); } catch {}
    process.exit(0);
  });
}
