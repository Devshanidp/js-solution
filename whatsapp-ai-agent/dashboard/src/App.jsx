import { useEffect, useRef, useState } from "react";
import { api } from "./api";

const QUICK_TESTS = [
  "Hi, need a good camera phone under 25k",
  "Redmi Note 14 vs Galaxy A36 – which is better?",
  "Earbuds for gym, budget 2000",
  "Delivery undo Kozhikode-lekku?",
  "I want to talk to a person",
];

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString();
}

// Renders WhatsApp-style *bold* and _italic_
function WhatsAppText({ text }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}

function StatusBar({ status }) {
  const Badge = ({ ok, label }) => (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {ok ? "●" : "○"} {label}
    </span>
  );
  if (!status) return <span className="text-xs text-white/70">Connecting to server…</span>;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge ok={status.aiConnected} label={status.aiConnected ? `AI: ${status.model}` : "AI key missing"} />
      <Badge ok={status.whatsappConnected} label={status.whatsappConnected ? "WhatsApp live" : "WhatsApp not set (test mode)"} />
    </div>
  );
}

function ConversationList({ items, selected, onSelect, onNewTest }) {
  return (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <button
          onClick={onNewTest}
          className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          + New test chat
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">
            No chats yet. Start a test chat to try the AI agent.
          </li>
        )}
        {items.map((c) => (
          <li key={c.phone}>
            <button
              onClick={() => onSelect(c.phone)}
              className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 ${
                selected === c.phone ? "bg-emerald-50" : ""
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-600">
                {(c.name || c.phone).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">
                    {c.name || `+${c.phone}`}
                  </span>
                  <span className="text-xs text-slate-400">{timeAgo(c.updatedAt)}</span>
                </div>
                <p className="truncate text-sm text-slate-500">{c.lastMessage?.text}</p>
                <div className="mt-1 flex gap-1">
                  {c.isTest && (
                    <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">TEST</span>
                  )}
                  {!c.botEnabled && (
                    <span className="rounded bg-rose-100 px-1.5 text-[10px] font-medium text-rose-600">
                      NEEDS HUMAN
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ChatWindow({ phone, onBack, onDeleted }) {
  const [convo, setConvo] = useState(null);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [lastTools, setLastTools] = useState([]);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const load = () => api.conversation(phone).then(setConvo).catch(() => setConvo(null));

  useEffect(() => {
    setConvo(null);
    setLastTools([]);
    load();
    const t = setInterval(load, 3000); // live refresh for real WhatsApp chats
    return () => clearInterval(t);
  }, [phone]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [convo?.messages.length, thinking]);

  const isTest = phone.startsWith("test-");

  async function send(msg = text) {
    if (!msg.trim()) return;
    setText("");
    setError("");
    try {
      if (isTest) {
        // optimistic: show the customer's message right away
        setConvo((c) => ({
          ...(c ?? { phone, messages: [], botEnabled: true }),
          messages: [...(c?.messages ?? []), { author: "customer", text: msg, at: new Date().toISOString() }],
        }));
        setThinking(true);
        const res = await api.testChat(phone, msg);
        setLastTools(res.toolsUsed ?? []);
      } else {
        await api.humanReply(phone, msg);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setThinking(false);
      load();
    }
  }

  async function toggleBot() {
    const updated = await api.setBot(phone, !convo.botEnabled);
    setConvo((c) => ({ ...c, ...updated }));
  }

  async function remove() {
    if (!window.confirm("Delete this conversation?")) return;
    await api.deleteConversation(phone);
    onDeleted();
  }

  return (
    <section className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button onClick={onBack} className="text-slate-500 md:hidden">←</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-slate-800">
            {convo?.name || (isTest ? "Test Customer" : `+${phone}`)}
          </h2>
          <p className="text-xs text-slate-500">
            {isTest ? "Test chat – you are the customer" : `+${phone}`}
          </p>
        </div>
        {convo && (
          <button
            onClick={toggleBot}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              convo.botEnabled ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
            title="Turn AI replies on/off for this chat"
          >
            {convo.botEnabled ? "🤖 AI replying" : "🙋 Human mode"}
          </button>
        )}
        <button onClick={remove} className="text-xs text-slate-400 hover:text-rose-600">Delete</button>
      </header>

      {convo && !convo.botEnabled && (
        <div className="bg-rose-50 px-4 py-2 text-sm text-rose-700">
          AI paused{convo.handoffReason ? `: ${convo.handoffReason}` : ""}. Reply below as staff, or switch AI back on.
        </div>
      )}

      {/* Messages */}
      <div className="chat-bg flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {convo?.messages.map((m, i) => {
          const mine = isTest ? m.author === "customer" : m.author !== "customer";
          return (
            <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${
                  mine ? "bg-[#d9fdd3]" : "bg-white"
                }`}
              >
                {m.author !== "customer" && (
                  <div className={`mb-0.5 text-[11px] font-semibold ${m.author === "bot" ? "text-emerald-700" : "text-indigo-600"}`}>
                    {m.author === "bot" ? "AI Agent" : "Staff"}
                  </div>
                )}
                <WhatsAppText text={m.text} />
                <div className="mt-1 text-right text-[10px] text-slate-400">
                  {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">typing…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* What the AI did behind the scenes */}
      {isTest && lastTools.length > 0 && (
        <div className="border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-500">
          AI used: {lastTools.map((t) => <code key={t} className="mr-1 rounded bg-slate-100 px-1">{t}</code>)}
        </div>
      )}

      {/* Quick test prompts */}
      {isTest && (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-white px-3 py-2">
          {QUICK_TESTS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              disabled={thinking}
              className="shrink-0 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && <div className="bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t border-slate-200 bg-white p-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isTest ? "Type as a customer…" : "Reply as staff…"}
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          disabled={thinking || !text.trim()}
          className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function OrdersView() {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    api.orders().then(setOrders);
    const t = setInterval(() => api.orders().then(setOrders), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4">
      {orders.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">No orders yet. Orders the AI takes on WhatsApp show up here.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">{o.id}</span>
                <span className="text-xs text-slate-400">{new Date(o.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {o.customerName} · +{o.phone}
              </p>
              <ul className="mt-2 space-y-0.5 text-sm">
                {o.items.map((it) => (
                  <li key={it.product_id}>
                    {it.name} × {it.quantity}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-semibold text-emerald-700">₹{o.total.toLocaleString("en-IN")}</p>
              <p className="mt-1 text-xs text-slate-500">
                {o.delivery} · {o.paymentMethod}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("chats");
  const [status, setStatus] = useState(null);
  const [convos, setConvos] = useState([]);
  const [selected, setSelected] = useState(null);

  const refresh = () => api.conversations().then(setConvos).catch(() => {});

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  function newTestChat() {
    const phone = `test-${Date.now().toString(36)}`;
    setConvos((c) => [
      { phone, name: "Test Customer", isTest: true, botEnabled: true, updatedAt: new Date().toISOString() },
      ...c,
    ]);
    setSelected(phone);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-emerald-700 px-4 py-3 text-white">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">💬 WhatsApp AI Agent</h1>
          <nav className="flex gap-1 rounded-lg bg-emerald-800/50 p-1 text-sm">
            {["chats", "orders"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 capitalize ${tab === t ? "bg-white text-emerald-800" : "text-white/80"}`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        <StatusBar status={status} />
      </header>

      <main className="min-h-0 flex-1">
        {tab === "orders" ? (
          <OrdersView />
        ) : (
          <div className="grid h-full md:grid-cols-[320px_1fr]">
            <div className={`${selected ? "hidden md:block" : "block"} h-full min-h-0`}>
              <ConversationList items={convos} selected={selected} onSelect={setSelected} onNewTest={newTestChat} />
            </div>
            <div className={`${selected ? "block" : "hidden md:flex"} h-full min-h-0`}>
              {selected ? (
                <ChatWindow
                  key={selected}
                  phone={selected}
                  onBack={() => setSelected(null)}
                  onDeleted={() => {
                    setSelected(null);
                    refresh();
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  Select a chat or start a test chat
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
