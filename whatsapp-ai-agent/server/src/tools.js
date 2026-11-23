// The "skills" the AI can use. The AI decides WHEN to call them;
// this code decides WHAT they return. Prices always come from products.json,
// so the AI can never make up a price.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addOrder, setBotEnabled } from "./store.js";
import { sendText } from "./whatsapp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// Re-read files each time so you can edit products.json without restarting
export const loadProducts = () =>
  JSON.parse(fs.readFileSync(path.join(DATA_DIR, "products.json"), "utf8"));
export const loadBusiness = () =>
  JSON.parse(fs.readFileSync(path.join(DATA_DIR, "business.json"), "utf8"));

// ---------- Tool definitions (what Claude sees) ----------
export const toolDefinitions = [
  {
    name: "search_products",
    description:
      "Search the shop's catalog. Use whenever the customer asks about products, wants suggestions, mentions a budget, a need (e.g. 'good camera phone', 'earbuds for gym') or a brand. Returns matching products with real prices and stock.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords from what the customer wants, e.g. 'camera phone', 'anc earbuds', 'samsung'",
        },
        category: {
          type: "string",
          enum: ["phone", "earbuds", "smartwatch", "accessory"],
          description: "Optional category filter",
        },
        max_price: { type: "number", description: "Customer's maximum budget, if mentioned" },
        min_price: { type: "number", description: "Minimum price, if relevant" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description: "Get full details of one product by its id (e.g. P002).",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "compare_products",
    description:
      "Compare 2-4 products side by side: price, discount, savings vs MRP, stock and key features. Use when the customer asks 'which is better', 'difference between', or is deciding between options.",
    input_schema: {
      type: "object",
      properties: {
        product_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      },
      required: ["product_ids"],
    },
  },
  {
    name: "get_business_info",
    description: "Get shop info: hours, location, delivery, returns, payment, EMI, warranty.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_order",
    description:
      "Place an order request ONLY after the customer clearly confirms they want to buy AND has given their name and delivery address (or says they will pick up in store). The shop owner then confirms it.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product_id: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["product_id", "quantity"],
          },
        },
        customer_name: { type: "string" },
        delivery: {
          type: "string",
          description: "Full delivery address, or 'store pickup'",
        },
        payment_method: { type: "string", description: "e.g. UPI, COD, card, EMI" },
        notes: { type: "string" },
      },
      required: ["items", "customer_name", "delivery"],
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Pass the chat to a human staff member. Use when the customer asks for a person, is angry or complaining, asks about a warranty claim / refund / damaged item, wants a special discount or bulk deal, or anything you cannot answer from the tools.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Short reason for staff" } },
      required: ["reason"],
    },
  },
];

// ---------- Tool implementations ----------
const summary = (p, cur) => ({
  id: p.id,
  name: p.name,
  price: `${cur}${p.price.toLocaleString("en-IN")}`,
  mrp: `${cur}${p.mrp.toLocaleString("en-IN")}`,
  discount: p.mrp > p.price ? `${Math.round((1 - p.price / p.mrp) * 100)}% off` : "no discount",
  inStock: p.inStock,
  description: p.description,
});

function searchProducts({ query = "", category, max_price, min_price }) {
  const { currency } = loadBusiness();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const scored = loadProducts()
    .filter((p) => !category || p.category === category)
    .filter((p) => max_price == null || p.price <= max_price)
    .filter((p) => min_price == null || p.price >= min_price)
    .map((p) => {
      const hay = [p.name, p.brand, p.category, p.description, ...p.tags].join(" ").toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { p, score };
    })
    .filter(({ score }) => score > 0 || words.length === 0 || category)
    .sort((a, b) => b.score - a.score || Number(b.p.inStock) - Number(a.p.inStock))
    .slice(0, 5);

  if (scored.length === 0) {
    return { results: [], note: "Nothing matched. Suggest the closest category or ask what they need." };
  }
  return { results: scored.map(({ p }) => summary(p, currency)) };
}

function getProductDetails({ product_id }) {
  const { currency } = loadBusiness();
  const p = loadProducts().find((x) => x.id === product_id);
  return p ? { ...summary(p, currency), brand: p.brand, tags: p.tags } : { error: "Product not found" };
}

function compareProducts({ product_ids }) {
  const { currency } = loadBusiness();
  const all = loadProducts();
  const items = product_ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
  if (items.length < 2) return { error: "Need at least 2 valid product ids" };
  const cheapest = items.reduce((a, b) => (a.price <= b.price ? a : b));
  const bestDeal = items.reduce((a, b) => (a.mrp - a.price >= b.mrp - b.price ? a : b));
  return {
    comparison: items.map((p) => ({
      ...summary(p, currency),
      youSave: `${currency}${(p.mrp - p.price).toLocaleString("en-IN")}`,
    })),
    cheapest: cheapest.name,
    biggestSaving: bestDeal.name,
    priceGap: `${currency}${(Math.max(...items.map((p) => p.price)) - cheapest.price).toLocaleString("en-IN")}`,
  };
}

async function createOrder(input, ctx) {
  const { currency } = loadBusiness();
  const all = loadProducts();
  const lines = [];
  let total = 0;
  for (const it of input.items) {
    const p = all.find((x) => x.id === it.product_id);
    if (!p) return { error: `Unknown product ${it.product_id}` };
    if (!p.inStock) return { error: `${p.name} is out of stock. Suggest an alternative.` };
    lines.push({ product_id: p.id, name: p.name, quantity: it.quantity, unitPrice: p.price });
    total += p.price * it.quantity;
  }
  const order = addOrder({
    phone: ctx.phone,
    customerName: input.customer_name,
    delivery: input.delivery,
    paymentMethod: input.payment_method ?? "not specified",
    notes: input.notes ?? "",
    items: lines,
    total,
  });

  const owner = process.env.OWNER_PHONE;
  if (owner && !ctx.isTest) {
    const itemsText = lines.map((l) => `• ${l.name} x${l.quantity}`).join("\n");
    await sendText(
      owner,
      `🛒 *New order ${order.id}*\n${itemsText}\nTotal: ${currency}${total.toLocaleString("en-IN")}\nName: ${input.customer_name}\nPhone: +${ctx.phone}\nDelivery: ${input.delivery}\nPayment: ${order.paymentMethod}`
    ).catch((e) => console.warn("owner alert failed", e.message));
  }
  return {
    success: true,
    orderId: order.id,
    total: `${currency}${total.toLocaleString("en-IN")}`,
    nextStep: "Tell the customer the order is received and the shop will confirm shortly.",
  };
}

async function handoffToHuman({ reason }, ctx) {
  setBotEnabled(ctx.phone, false, reason);
  const owner = process.env.OWNER_PHONE;
  if (owner && !ctx.isTest) {
    await sendText(
      owner,
      `🙋 *Customer needs a human*\nPhone: +${ctx.phone}\nReason: ${reason}\nOpen the dashboard to reply.`
    ).catch((e) => console.warn("owner alert failed", e.message));
  }
  return {
    success: true,
    note: "Bot is now paused for this chat. Tell the customer a team member will reply soon.",
  };
}

export async function runTool(name, input, ctx) {
  switch (name) {
    case "search_products":
      return searchProducts(input);
    case "get_product_details":
      return getProductDetails(input);
    case "compare_products":
      return compareProducts(input);
    case "get_business_info":
      return loadBusiness();
    case "create_order":
      return createOrder(input, ctx);
    case "handoff_to_human":
      return handoffToHuman(input, ctx);
    default:
      return { error: `Unknown tool ${name}` };
  }
}
