const { AppError } = require("./logic");

/**
 * Optional Tamil <-> English translation. Configured ONLY through environment
 * variables (see .env.example), so API keys never reach the browser.
 * Only the transcript TEXT is sent to the chosen provider, never the audio.
 */
const LANGS = ["ta", "en"];
const provider = () => (process.env.TRANSLATION_PROVIDER || "none").toLowerCase();

function status() {
  const p = provider();
  const enabled =
    p === "mymemory" ||
    (p === "libretranslate" && !!process.env.LIBRETRANSLATE_URL) ||
    (p === "google" && !!process.env.GOOGLE_TRANSLATE_API_KEY);
  return { enabled, provider: enabled ? p : "none" };
}

async function timedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function translate(text, from, to) {
  if (!LANGS.includes(from) || !LANGS.includes(to)) {
    throw new AppError(400, "Only Tamil (ta) and English (en) are supported.");
  }
  const { enabled, provider: p } = status();
  if (!enabled) {
    throw new AppError(
      503,
      "Automatic translation is not configured on the server. " +
        "Enter the translation manually or set TRANSLATION_PROVIDER in .env."
    );
  }

  try {
    if (p === "mymemory") {
      if (text.length > 450) {
        throw new AppError(400, "MyMemory accepts at most about 450 characters. Shorten the text.");
      }
      const email = process.env.MYMEMORY_EMAIL
        ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}`
        : "";
      const res = await timedFetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}${email}`
      );
      const data = await res.json();
      if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) {
        throw new Error(data.responseDetails || `HTTP ${res.status}`);
      }
      return { translatedText: data.responseData.translatedText, provider: p };
    }

    if (p === "libretranslate") {
      const base = process.env.LIBRETRANSLATE_URL.replace(/\/$/, "");
      const body = { q: text, source: from, target: to, format: "text" };
      if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
      const res = await timedFetch(`${base}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.translatedText) throw new Error(data.error || `HTTP ${res.status}`);
      return { translatedText: data.translatedText, provider: p };
    }

    // google
    const res = await timedFetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: from, target: to, format: "text" })
      }
    );
    const data = await res.json();
    const out = data.data?.translations?.[0]?.translatedText;
    if (!res.ok || !out) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return { translatedText: out, provider: p };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const reason = error.name === "AbortError" ? "the service timed out" : error.message;
    throw new AppError(502, `Translation failed: ${reason}`);
  }
}

module.exports = { translate, status };
