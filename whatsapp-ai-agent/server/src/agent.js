// The AI brain: reads the conversation, understands intent,
// calls tools (search, compare, order...) and writes a human-like reply.
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool, loadBusiness } from "./tools.js";

let client = null;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

const MAX_HISTORY = 30; // how many past messages the AI remembers per customer
const MAX_TOOL_ROUNDS = 6;

function systemPrompt(convo) {
  const b = loadBusiness();
  return `You are ${b.assistantName}, the WhatsApp sales assistant for ${b.name}. ${b.description}
Today is ${new Date().toDateString()}. Customer name on WhatsApp: ${convo.name || "unknown"}.

HOW TO TALK
- Sound like a friendly, helpful shop staff member on WhatsApp, not a robot. Warm, short, natural.
- Keep replies short: usually 1-4 short lines. Use line breaks, not long paragraphs.
- Reply in the customer's language and style. If they write Malayalam, Manglish (Malayalam in English letters), Hindi or Arabic, reply the same way.
- WhatsApp formatting only: *bold*, _italic_, simple "•" bullets. No markdown headings, no tables, no links you weren't given.
- Use at most one emoji per message, and only when it fits.

UNDERSTAND INTENT FIRST
Work out what the customer really wants: browsing, a recommendation, comparing options, price/budget check, ready to buy, after-sales help, or a complaint.
- If the need is vague ("need a phone"), ask ONE short question (budget or main use) before listing products.
- Recommend at most 3 products, best match first, with a one-line reason each, tied to what they said.
- When they are choosing between options, use compare_products and give a clear verdict ("For your use, I'd pick X because...").
- Gently suggest a useful add-on (case, charger) only after they pick a product. Never be pushy.

FACTS
- NEVER invent products, prices, stock, discounts or policies. Always get them from tools.
- If something is out of stock, say so and offer the closest in-stock alternative.
- You cannot give extra discounts. For bargaining, bulk orders, warranty claims, refunds, damaged items, angry customers, or when they ask for a person -> use handoff_to_human.
- Questions about other shops' or online prices: you only know this shop's prices. Highlight the discount vs MRP, warranty, bill and local support instead.

ORDERS
When they want to buy: confirm product + quantity, then ask for name, delivery address (or store pickup) and payment method (UPI/COD/card/EMI). Read back a short summary with the total and get a "yes" before calling create_order.

Stay on topic (this shop and its products). Politely steer unrelated questions back.`;
}

/** Convert stored messages into Claude's user/assistant format. */
function toClaudeMessages(messages) {
  const out = [];
  for (const m of messages.slice(-MAX_HISTORY)) {
    const role = m.author === "customer" ? "user" : "assistant";
    const text = m.author === "human" ? `[Staff member replied]: ${m.text}` : m.text;
    const last = out.at(-1);
    if (last && last.role === role) last.content += "\n" + text; // merge back-to-back msgs
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift(); // must start with the customer
  return out;
}

/**
 * Generate the bot's reply for a conversation.
 * Returns { reply, toolsUsed }.
 */
export async function generateReply(convo) {
  const messages = toClaudeMessages(convo.messages);
  if (messages.length === 0) return { reply: null, toolsUsed: [] };
  const ctx = { phone: convo.phone, isTest: convo.isTest };
  const toolsUsed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await getClient().messages.create({
      model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
      max_tokens: 1024,
      system: systemPrompt(convo),
      tools: toolDefinitions,
      messages,
    });

    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      const reply = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply, toolsUsed };
    }

    // Run every tool the AI asked for, then send the results back to it
    const results = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      toolsUsed.push(block.name);
      let output;
      try {
        output = await runTool(block.name, block.input, ctx);
      } catch (e) {
        output = { error: e.message };
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply: "Sorry, give me a moment, I'll ask our team to help you with this. 🙏",
    toolsUsed,
  };
}
