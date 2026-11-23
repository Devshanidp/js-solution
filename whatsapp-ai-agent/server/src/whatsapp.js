// Everything that talks to Meta's WhatsApp Cloud API lives here.
import crypto from "node:crypto";

const API = () =>
  `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || "v21.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

export const whatsappConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

async function callApi(body) {
  const res = await fetch(API(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${err}`);
  }
  return res.json();
}

/** Send a plain text message. WhatsApp limit is 4096 characters. */
export async function sendText(to, text) {
  if (!whatsappConfigured()) {
    console.warn("[whatsapp] not configured - message not sent:", text.slice(0, 80));
    return;
  }
  for (const chunk of splitText(text, 4000)) {
    await callApi({ to, type: "text", text: { body: chunk, preview_url: false } });
  }
}

/** Show blue ticks + "typing..." while the AI thinks. */
export async function markReadAndTyping(messageId) {
  if (!whatsappConfigured()) return;
  try {
    await callApi({
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    });
  } catch (e) {
    console.warn("[whatsapp] mark read failed:", e.message);
  }
}

/** Check the X-Hub-Signature-256 header so fake requests are rejected. */
export function verifySignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // skip check if you haven't set it (dev only!)
  const header = req.get("x-hub-signature-256") || "";
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
  return (
    header.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

/**
 * Turn Meta's nested webhook payload into a simple list:
 * [{ id, from, name, text }]
 */
export function parseIncoming(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contacts = value.contacts ?? [];
      for (const m of value.messages ?? []) {
        const name = contacts.find((c) => c.wa_id === m.from)?.profile?.name ?? "";
        out.push({ id: m.id, from: m.from, name, text: messageToText(m) });
      }
    }
  }
  return out;
}

function messageToText(m) {
  switch (m.type) {
    case "text":
      return m.text.body;
    case "interactive":
      return (
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        "[customer tapped a button]"
      );
    case "button":
      return m.button?.text ?? "[customer tapped a button]";
    case "image":
      return `[customer sent a photo${m.image?.caption ? ` with caption: "${m.image.caption}"` : ""}]`;
    case "audio":
      return "[customer sent a voice message]";
    case "location":
      return `[customer shared a location: ${m.location?.name ?? ""} ${m.location?.address ?? ""}]`;
    default:
      return `[customer sent a ${m.type} message]`;
  }
}

function splitText(text, max) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
