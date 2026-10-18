/* Shared helpers for every ResQRoute page. Loaded with a normal <script> tag. */

const STATUS_CLASS = { PENDING: "amber", ACCEPTED: "green", DECLINED: "red", CANCELLED: "grey", COMPLETED: "blue" };
const READY_CLASS = { READY: "green", PARTIAL: "amber", UNAVAILABLE: "red" };
const READY_TEXT = { READY: "Meets stated needs", PARTIAL: "Missing a requirement", UNAVAILABLE: "Unavailable" };
const SOURCE_TEXT = {
  gps: "Real GPS from this device",
  demo: "SIMULATED demo coordinates (not real GPS)",
  manual: "MANUALLY ENTERED coordinates (not verified GPS)",
  unknown: "Source not recorded"
};
const LANG_NAMES = { "ta-IN": "Tamil", "en-IN": "English (India)", "en-US": "English (US)", ta: "Tamil", en: "English" };

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const coordsOK = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function fmtTime(value) {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "Not available";
}

const badge = (status) =>
  `<span class="badge ${STATUS_CLASS[status] || ""}">${esc(status)}</span>`;

/** Calls /api/... and returns parsed JSON, or throws an Error with a readable message. */
async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (options.body && !(options.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(options.body);
  }
  let res;
  try {
    res = await fetch("/api" + path, opts);
  } catch {
    throw new Error("Cannot reach the ResQRoute server. Check that it is running (npm start).");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

/** Runs fn now and then every `ms` while the tab is visible. */
function every(ms, fn) {
  fn();
  return setInterval(() => { if (!document.hidden) fn(); }, ms);
}

function toast(message, isError = false) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), isError ? 7000 : 4000);
}

/** body must be already-escaped HTML. Resolves { confirmed, value }. */
function confirmDialog({ title, body = "", confirmText = "Confirm", danger = false, inputLabel = "" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <div>${body}</div>
        ${inputLabel ? `<label>${esc(inputLabel)}<textarea name="msg" rows="2" maxlength="300"></textarea></label>` : ""}
        <div class="dlg-actions">
          <button class="btn" value="cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(confirmText)}</button>
        </div>
      </form>`;
    d.addEventListener("close", () => {
      const value = d.querySelector("textarea")?.value.trim() || "";
      const confirmed = d.returnValue === "ok";
      d.remove();
      resolve({ confirmed, value });
    });
    document.body.appendChild(d);
    d.showModal();
  });
}

function renderNav(active) {
  const links = [
    ["ambulance", "ambulance.html", "Ambulance"],
    ["hospital", "index.html", "Hospital dashboard"],
    ["matches", "hospital-matches.html", "Hospital matching"],
    ["inbox", "hospital-voice-inbox.html", "Voice inbox"]
  ];
  document.getElementById("nav").innerHTML = links
    .map(([key, href, label]) =>
      `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
}

/** Creates a Leaflet map, or shows a clear message if the map library could not load. */
function makeMap(elementId, center, zoom = 12) {
  const el = document.getElementById(elementId);
  if (!window.L) {
    el.innerHTML = '<div class="notice">The map could not load. The map library and tiles need an internet connection. Coordinates are still shown as text.</div>';
    return null;
  }
  const map = L.map(el).setView(center, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  return map;
}

function dot(map, lat, lon, color, label, radius = 9) {
  if (!map || !coordsOK(lat, lon)) return null;
  const m = L.circleMarker([lat, lon], { radius, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
  if (label) m.bindPopup(esc(label));
  return m;
}

const directionsURL = (aLat, aLon, bLat, bLon) =>
  `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${aLat}%2C${aLon}%3B${bLat}%2C${bLon}`;

const mapLinkURL = (lat, lon) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
