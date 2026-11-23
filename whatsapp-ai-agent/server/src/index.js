import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import {
  verifySignature,
  parseIncoming,
  sendText,
  markReadAndTyping,
  whatsappConfigured,
} from "./whatsapp.js";
import { generateReply } from "./agent.js";
import {
  getConversation,
  addMessage,
  setBotEnabled,
  listConversations,
  findConversation,
  deleteConversation,
  listOrders,
} from "./store.js";
import { loadProducts } from "./tools.js";

const app = express();
// Render (and most hosts) sit behind a proxy. This makes req.ip the visitor's real IP.
app.set("trust proxy", 1);

// ---------- CORS: only your website + localhost may call the API from a browser ----------
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = not a browser (Meta webhook, curl). Those are allowed through.
      if (!origin || isLocalhost(origin) || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false); // browser blocks the response
    },
  })
);
// keep the raw body so we can verify Meta's signature
app.use(express.json({ limit: "100kb", verify: (req, _res, buf) => (req.rawBody = buf) }));

// ---------- Admin key: protects every dashboard route ----------
const ADMIN_KEY = process.env.ADMIN_KEY || "";
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: "ADMIN_KEY is not set on the server" });
  const given = Buffer.from(String(req.get("x-admin-key") || ""));
  const real = Buffer.from(ADMIN_KEY);
  // timingSafeEqual stops attackers guessing the key one character at a time
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: "Wrong or missing admin key" });
  }
  next();
}

// ---------- Rate limit for the public demo chat ----------
const RATE_LIMIT = 20; // messages
const RATE_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes
const MAX_CHARS = 500;
const hits = new Map(); // ip -> [timestamps]
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    const waitMin = Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 60000);
    res.set("Retry-After", String(waitMin * 60));
    return res.status(429).json({ error: `Too many messages. Please try again in ${waitMin} min.` });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}
// Clean up old IPs every 10 minutes so memory doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    if (!list.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

// ---------- Core: handle one customer message ----------
// A per-customer queue so 3 quick messages get answered in order, not all at once.
const queues = new Map();
function enqueue(phone, job) {
  const prev = queues.get(phone) ?? Promise.resolve();
  const next = prev.then(job, job).finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
  queues.set(phone, next);
  return next;
}

async function handleCustomerMessage({ phone, name, text, sendToWhatsApp }) {
  getConversation(phone, name);
  addMessage(phone, "customer", text);

  return enqueue(phone, async () => {
    const convo = getConversation(phone);
    if (!convo.botEnabled) return { reply: null, paused: true }; // a human is handling it

    let reply, toolsUsed;
    try {
      ({ reply, toolsUsed } = await generateReply(convo));
    } catch (e) {
      console.error("[agent] error:", e.message);
      reply = "Sorry, I'm having a small technical issue. Please try again in a minute 🙏";
      toolsUsed = [];
    }
    if (!reply) return { reply: null, toolsUsed };

    addMessage(phone, "bot", reply);
    if (sendToWhatsApp) await sendText(phone, reply);
    return { reply, toolsUsed, botEnabled: getConversation(phone).botEnabled };
  });
}

// ---------- WhatsApp webhook ----------
// 1) Meta calls this once to verify your webhook URL
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2) Meta sends every incoming message here
const seenIds = new Set(); // Meta sometimes sends the same message twice
app.post("/webhook", (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // reply to Meta immediately, then think

  for (const msg of parseIncoming(req.body)) {
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);
    if (seenIds.size > 5000) seenIds.delete(seenIds.values().next().value);

    console.log(`📩 ${msg.from} (${msg.name}): ${msg.text}`);
    markReadAndTyping(msg.id);
    handleCustomerMessage({
      phone: msg.from,
      name: msg.name,
      text: msg.text,
      sendToWhatsApp: true,
    }).catch((e) => console.error("[webhook] failed:", e));
  }
});

// ---------- Public demo chat (used by the website, no admin key) ----------
// Test chat: pretend to be a customer without needing WhatsApp
app.post("/api/test-chat", rateLimit, async (req, res) => {
  const { phone, text } = req.body || {};
  const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 40) : "Test Customer";
  if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_CHARS) {
    return res.status(400).json({ error: `Message too long (max ${MAX_CHARS} characters)` });
  }
  // Only "test-" ids with safe characters, so nobody can write into a real customer's chat
  const id = typeof phone === "string" && phone ? phone : "test-user";
  const safeId = id.startsWith("test-") ? id : `test-${id}`;
  if (!/^test-[A-Za-z0-9_-]{1,40}$/.test(safeId)) return res.status(400).json({ error: "invalid id" });

  const result = await handleCustomerMessage({
    phone: safeId,
    name,
    text: text.trim(),
    sendToWhatsApp: false,
  });
  res.json(result);
});

// ---------- Dashboard API (needs the x-admin-key header) ----------
app.use("/api", requireAdmin);

app.get("/api/status", (_req, res) =>
  res.json({
    whatsappConnected: whatsappConfigured(),
    aiConnected: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
  })
);

app.get("/api/conversations", (_req, res) => res.json(listConversations()));

app.get("/api/conversations/:phone", (req, res) => {
  const c = findConversation(req.params.phone);
  c ? res.json(c) : res.sendStatus(404);
});

app.delete("/api/conversations/:phone", (req, res) => {
  deleteConversation(req.params.phone);
  res.sendStatus(204);
});

// Staff replies manually from the dashboard
app.post("/api/conversations/:phone/reply", async (req, res) => {
  const { phone } = req.params;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  const convo = findConversation(phone);
  if (!convo) return res.sendStatus(404);
  try {
    if (!convo.isTest) await sendText(phone, text.trim());
    addMessage(phone, "human", text.trim());
    res.json({ ok: true });
  } catch (e) {
    // Note: WhatsApp only allows free-form replies within 24h of the customer's last message
    res.status(502).json({ error: e.message });
  }
});

// Turn the bot on/off for one chat (human takeover)
app.post("/api/conversations/:phone/bot", (req, res) => {
  const convo = setBotEnabled(req.params.phone, Boolean(req.body.enabled), "Taken over from dashboard");
  res.json(convo);
});

app.get("/api/products", (_req, res) => res.json(loadProducts()));
app.get("/api/orders", (_req, res) => res.json(listOrders()));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp AI Agent running on http://localhost:${PORT}`);
  console.log(`   WhatsApp: ${whatsappConfigured() ? "connected" : "NOT configured (test chat only)"}`);
  console.log(`   Claude:   ${process.env.ANTHROPIC_API_KEY ? "key found" : "NO API KEY - add it to .env"}`);
  console.log(`   Admin:    ${ADMIN_KEY ? "dashboard protected" : "NO ADMIN_KEY - dashboard API is locked"}`);
  console.log(`   CORS:     localhost${allowedOrigins.length ? ", " + allowedOrigins.join(", ") : ""}`);
});
