// The server's ADMIN_KEY. Asked once, then remembered in this browser.
function adminKey() {
  let key = localStorage.getItem("adminKey");
  if (!key) {
    key = window.prompt("Enter the dashboard admin key (ADMIN_KEY from server/.env):") || "";
    if (key) localStorage.setItem("adminKey", key);
  }
  return key;
}

// Small helper for calling the Node server
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey() },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) localStorage.removeItem("adminKey"); // wrong key: ask again next time
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  status: () => request("/status"),
  conversations: () => request("/conversations"),
  conversation: (phone) => request(`/conversations/${encodeURIComponent(phone)}`),
  deleteConversation: (phone) =>
    request(`/conversations/${encodeURIComponent(phone)}`, { method: "DELETE" }),
  testChat: (phone, text) => request("/test-chat", { method: "POST", body: { phone, text } }),
  humanReply: (phone, text) =>
    request(`/conversations/${encodeURIComponent(phone)}/reply`, { method: "POST", body: { text } }),
  setBot: (phone, enabled) =>
    request(`/conversations/${encodeURIComponent(phone)}/bot`, { method: "POST", body: { enabled } }),
  orders: () => request("/orders"),
};
