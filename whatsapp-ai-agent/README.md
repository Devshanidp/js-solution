# 💬 WhatsApp AI Agent

An AI agent that **has real conversations** on WhatsApp, not keyword auto-replies.

- 🧠 **Understands what the customer wants**: browsing, budget, comparing options, ready to buy, complaint
- 🛍️ **Suggests products** from YOUR catalog, with real prices and stock (it never makes up a price)
- ⚖️ **Compares prices**: "Redmi vs Samsung, which is better?" gets a side-by-side answer and a clear pick
- 🗣️ **Replies like a person**, in the customer's language (English, Malayalam, Manglish, Hindi…)
- 🛒 **Takes orders**: collects name, address and payment method, then alerts you on WhatsApp
- 🙋 **Hands off to a human** when the customer is angry, wants a discount or asks for a person
- 📊 **Dashboard** (React + Tailwind): see every chat live, take over any chat, test the AI, view orders

```
Customer on WhatsApp ─▶ Meta Cloud API ─▶ your server (/webhook)
                                              │
                                     Claude AI + tools
                        (search · compare · shop info · order · handoff)
                                              │
Customer gets a reply ◀─ Meta Cloud API ◀─────┘        Dashboard (React) ◀─ /api
```

---

## 1. Run it on your computer (10 minutes, no WhatsApp needed yet)

You need **Node.js 20 or newer** → https://nodejs.org

```bash
# Terminal 1 – the server
cd server
npm install
cp .env.example .env        # on Windows: copy .env.example .env
```

Open `server/.env` and paste your Claude API key (from https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run dev
```

```bash
# Terminal 2 – the dashboard
cd dashboard
npm install
npm run dev
```

Open **http://localhost:5173**, click **+ New test chat** and chat as if you were a customer.
Try the quick buttons ("Redmi vs Galaxy A36", "Delivery undo Kozhikode-lekku?" …).
Under the chat you'll see which tools the AI used.

---

## 2. Make it YOUR business

Edit two files in `server/data/` (no restart needed):

| File | What to put in it |
|---|---|
| `business.json` | Shop name, assistant name, hours, location, delivery, returns, payment |
| `products.json` | Your products: `id`, `name`, `category`, `price`, `mrp`, `inStock`, `tags`, `description` |

**Tip:** put the words customers actually type into `tags` (e.g. `"gaming"`, `"students"`, `"long battery"`). That's how search finds the right products.

If you change the categories (say, to a clothing shop), also update the `enum` list in `server/src/tools.js` → `search_products`.

To change the AI's personality or rules, edit `systemPrompt()` in `server/src/agent.js`.

---

## 3. Connect real WhatsApp (Meta Cloud API, official and free to start)

1. Go to **https://developers.facebook.com** → *My Apps* → **Create App** → choose **Business** → add the **WhatsApp** product.
2. In **WhatsApp → API Setup** copy:
   - **Temporary access token** → `WHATSAPP_TOKEN`
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - Add your own number as a test recipient.
3. In **App Settings → Basic** copy the **App Secret** → `WHATSAPP_APP_SECRET`.
4. Make up a secret word → `WHATSAPP_VERIFY_TOKEN`.
5. Put your own WhatsApp number in `OWNER_PHONE` (e.g. `919876543210`). You'll get order and handoff alerts there.
6. Restart the server.

### Give your server a public URL
Meta has to reach your computer. For testing, use a tunnel:

```bash
npx ngrok http 3000          # or: cloudflared tunnel --url http://localhost:3000
```

Copy the `https://....` URL it shows you.

7. In Meta: **WhatsApp → Configuration → Webhook → Edit**
   - Callback URL: `https://YOUR-URL/webhook`
   - Verify token: the same word as `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and save**. The server terminal should print `✅ Webhook verified by Meta`.
   - Under **Webhook fields**, subscribe to **messages**.
8. Send a WhatsApp message to the test number. The AI replies 🎉

### Going live
- The temporary token expires in 24 h. Create a **System User** token in Meta Business Settings (never expires).
- Add your real business number and complete **Business Verification**.
- Deploy the `server` folder to Render, Railway, a VPS etc. and point the webhook at that URL.
- **24-hour rule:** WhatsApp lets you send free-form replies only within 24 h of the customer's last message. After that you need an approved *template* message.

---

## 4. How the "intelligence" works

The AI isn't matching keywords. Each message goes to Claude with:
1. **The conversation history** (last 30 messages), so it remembers context ("the second one" = the phone it just suggested).
2. **A system prompt** with your shop's rules and tone.
3. **Tools** it can call on its own:

| Tool | When the AI uses it |
|---|---|
| `search_products` | "need a phone under 20k for gaming" |
| `get_product_details` | "tell me more about that one" |
| `compare_products` | "which is better", "difference between" → prices, savings, cheapest, verdict |
| `get_business_info` | hours, delivery, EMI, returns |
| `create_order` | customer confirmed and gave name + address |
| `handoff_to_human` | angry, refund, bargaining, "talk to a person" → AI pauses for that chat |

Prices come from `products.json`, never from the AI's imagination.

---

## Project structure

```
server/
  src/index.js      ← Express server: webhook + dashboard API
  src/agent.js      ← AI brain (Claude + tool loop + personality)
  src/tools.js      ← search, compare, order, handoff
  src/whatsapp.js   ← send messages, verify Meta signature
  src/store.js      ← saves chats/orders to data/*.json
  data/             ← business.json, products.json (+ chats/orders saved here)
dashboard/
  src/App.jsx       ← chats, test chat, human takeover, orders
```

## Costs (roughly)
- **WhatsApp:** replies to customers within 24 h of their message are free. Business-started template messages are paid per message.
- **Claude:** `claude-haiku-5-5` is the cheapest. A typical chat costs a fraction of a rupee. Switch to `claude-sonnet-5-5` in `.env` for smarter answers.

## Next upgrades (ideas)
- Product photos: send images with the WhatsApp `image` message type
- Buttons and lists: WhatsApp `interactive` messages for "Buy now / Compare / Talk to staff"
- Voice notes: transcribe audio, then pass the text to the agent
- Database: swap `store.js` for MongoDB or Supabase when you have many chats
- Login for the dashboard before putting it online
