// Remote view (ADR-0023, contract/snapshot.md): fetch the encrypted
// snapshot, decrypt it with the key from the link's fragment, draw it.
// The link: .../#o=<gist owner>&g=<gist id>&k=<key>  (or s=local for a
// snapshot.json beside this page, for testing). Nothing here is sent anywhere.
"use strict";

const AAD = new TextEncoder().encode("activity-sensor-snapshot/1");
const $ = (id) => document.getElementById(id);

function params() {
  const out = {};
  for (const part of location.hash.replace(/^#/, "").split("&")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function b64u(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function readSnapshot(p) {
  const url = p.s === "local"
    ? "snapshot.json?t=" + Date.now()
    : `https://gist.githubusercontent.com/${encodeURIComponent(p.o)}/${encodeURIComponent(p.g)}/raw/snapshot.json?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(res.status === 404 ? "No snapshot at this link any more." : "Could not reach the snapshot (" + res.status + ").");
  const env = await res.json();
  if (env.format !== "activity-sensor-snapshot" || env.v !== 1 || env.alg !== "A256GCM") throw new Error("Not a snapshot this page can read.");
  const key = await crypto.subtle.importKey("raw", b64u(p.k), "AES-GCM", false, ["decrypt"]);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u(env.iv), additionalData: AAD, tagLength: 128 }, key, b64u(env.ct));
  } catch (_) {
    throw new Error("This link's key does not open the snapshot. Was remote view set up again? Scan the new link.");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function fmtWhen(iso, now) {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - day) / 86400000);
  const t = fmtTime(d);
  return days === 0 ? "today " + t : days === 1 ? "yesterday " + t : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " " + t;
}
function ago(iso, now) {
  const m = Math.round((now - new Date(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function drawPlace(p, now) {
  const card = el("article", "card");
  const head = el("div", "place-head");
  head.append(el("h2", null, p.name));
  if (p.synced_at) head.append(el("span", "dim small", "read " + ago(p.synced_at, now)));
  card.append(head);

  if (p.state) {
    const s = el("div", "state");
    s.append(el("span", "dot" + (p.state.open ? " open" : "")));
    s.append(el("strong", null, p.state.open ? "Open" : "Closed"));
    s.append(el("span", "dim", "since " + fmtWhen(p.state.since, now)));
    card.append(s);
  } else if (p.last_moved) {
    card.append(el("p", "dim", "Last moved " + fmtWhen(p.last_moved, now)));
  }

  const chips = el("div", "row");
  if (p.lock && p.lock.locked !== null) {
    chips.append(el("span", "chip lock", (p.lock.locked ? "Probably locked" : "Probably unlocked") + (p.lock.since ? " · " + fmtWhen(p.lock.since, now) : "")));
  }
  chips.append(el("span", "chip", p.today.events + " today"));
  if (p.today.tried > 0) chips.append(el("span", "chip tried", p.today.tried + " tried the door"));
  card.append(chips);

  const h = p.health, bits = [];
  if (h.cell_mv) bits.push((h.cell_mv / 1000).toFixed(2) + " V" + (h.charging ? ", charging" : h.usb ? ", on USB" : ""));
  if (h.temperature_c != null) bits.push(h.temperature_c.toFixed(1) + " °C");
  if (h.rssi_dbm != null) bits.push(h.rssi_dbm + " dBm");
  if (h.bench) bits.push("on the bench");
  if (h.firmware) bits.push("fw " + h.firmware);
  if (bits.length) card.append(el("p", "health", bits.join(" · ")));

  const list = el("ul", "events");
  let lastDay = "";
  for (const e of p.events) {
    const d = new Date(e.start);
    const day = d.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const today = new Date(now).toDateString();
      list.append(el("li", "day", day === today ? "Today" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })));
    }
    const li = el("li", "ev" + (e.tried ? " tried" : ""));
    const t = el("time", null, fmtTime(d));
    t.dateTime = e.start;
    li.append(t, el("span", "name", e.name + (e.who && !e.name.includes(e.who) ? " · " + e.who : "")));
    if (e.detail) li.append(el("span", "detail", e.detail));
    list.append(li);
  }
  if (!p.events.length) list.append(el("li", "dim", "Nothing in the last seven days."));
  card.append(list);
  return card;
}

async function refresh() {
  const p = params();
  const note = $("note");
  note.hidden = true;
  if (!p.k || (p.s !== "local" && (!p.o || !p.g))) {
    $("age").textContent = "";
    note.textContent = "This link is missing its key. Scan the QR code again on the phone at home (Settings, Remote view, Show link).";
    note.hidden = false;
    return;
  }
  try {
    const snap = await readSnapshot(p);
    const now = new Date();
    const age = (now - new Date(snap.generated_at)) / 60000;
    $("age").textContent = "Updated " + ago(snap.generated_at, now) + (snap.hub.link !== "live" ? " · the home phone is " + snap.hub.link : "");
    if (age > 15) {
      note.textContent = "The phone at home has not written for " + Math.round(age) + " minutes: it may be off, asleep, or without internet.";
      note.hidden = false;
    }
    const places = $("places");
    places.replaceChildren(...snap.places.map((pl) => drawPlace(pl, now)));
  } catch (e) {
    note.textContent = e.message || String(e);
    note.hidden = false;
  }
}

$("refresh").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
refresh();
setInterval(refresh, 60000);
