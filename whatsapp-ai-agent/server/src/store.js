// Simple JSON-file storage for conversations and orders.
// Good for learning & small shops. Swap for MongoDB/Postgres when you grow.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const CONVOS_FILE = path.join(DATA_DIR, "conversations.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const conversations = readJson(CONVOS_FILE, {}); // { [phone]: conversation }
const orders = readJson(ORDERS_FILE, []);

// Save to disk at most once per second (avoids writing on every message)
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(CONVOS_FILE, JSON.stringify(conversations, null, 2));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  }, 1000);
}

export function getConversation(phone, name = "") {
  if (!conversations[phone]) {
    conversations[phone] = {
      phone,
      name,
      botEnabled: true, // false = a human has taken over
      handoffReason: null,
      isTest: phone.startsWith("test-"),
      messages: [],
      updatedAt: new Date().toISOString(),
    };
  }
  if (name && !conversations[phone].name) conversations[phone].name = name;
  return conversations[phone];
}

/** author: "customer" | "bot" | "human" */
export function addMessage(phone, author, text) {
  const convo = getConversation(phone);
  const msg = { author, text, at: new Date().toISOString() };
  convo.messages.push(msg);
  convo.updatedAt = msg.at;
  scheduleSave();
  return msg;
}

export function setBotEnabled(phone, enabled, reason = null) {
  const convo = getConversation(phone);
  convo.botEnabled = enabled;
  convo.handoffReason = enabled ? null : reason;
  scheduleSave();
  return convo;
}

export function listConversations() {
  return Object.values(conversations)
    .map((c) => ({
      phone: c.phone,
      name: c.name,
      botEnabled: c.botEnabled,
      handoffReason: c.handoffReason,
      isTest: c.isTest,
      lastMessage: c.messages.at(-1) ?? null,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findConversation(phone) {
  return conversations[phone] ?? null;
}

export function deleteConversation(phone) {
  delete conversations[phone];
  scheduleSave();
}

export function addOrder(order) {
  const saved = {
    id: "ORD" + String(orders.length + 1).padStart(4, "0"),
    status: "new",
    createdAt: new Date().toISOString(),
    ...order,
  };
  orders.push(saved);
  scheduleSave();
  return saved;
}

export function listOrders() {
  return [...orders].reverse();
}
