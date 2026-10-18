require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { createStore } = require("./lib/store");
const logic = require("./lib/logic");
const translator = require("./lib/translate");

const { AppError, STATUS } = logic;

const PORT = Number(process.env.PORT) || 5000;
const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB) || 15;

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const HOSPITALS_FILE = path.join(DATA_DIR, "hospitals.json");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------
// Demo data. Existing files are NEVER overwritten.
// All hospitals are fictional.
// ---------------------------------------------------------------
if (!fs.existsSync(HOSPITALS_FILE)) {
  fs.writeFileSync(HOSPITALS_FILE, JSON.stringify([
    { id: "H001", name: "Chennai City General Hospital", area: "Central Chennai (demo)",
      latitude: 13.0827, longitude: 80.2707, availableBeds: 12, icuBeds: 3,
      specialists: ["Cardiology", "General Medicine"], equipment: ["Ventilator", "ECG"], available: true },
    { id: "H002", name: "GreenLife Medical Centre", area: "Teynampet (demo)",
      latitude: 13.0604, longitude: 80.2496, availableBeds: 5, icuBeds: 0,
      specialists: ["Orthopedics", "General Medicine"], equipment: ["X-Ray", "ECG"], available: true },
    { id: "H003", name: "Emergency Care Hospital", area: "Kilpauk (demo)",
      latitude: 13.0475, longitude: 80.2090, availableBeds: 8, icuBeds: 2,
      specialists: ["Cardiology", "Neurology"], equipment: ["Ventilator", "ECG", "CT Scanner"], available: true },
    { id: "H004", name: "Lakeside Neuro & Trauma Institute", area: "Adyar (demo)",
      latitude: 13.0012, longitude: 80.2565, availableBeds: 4, icuBeds: 1,
      specialists: ["Neurology", "Orthopedics"], equipment: ["CT Scanner", "X-Ray", "Ventilator"], available: true }
  ], null, 2));
}
if (!fs.existsSync(REQUESTS_FILE)) fs.writeFileSync(REQUESTS_FILE, "[]");

const hospitalStore = createStore(HOSPITALS_FILE);
const requestStore = createStore(REQUESTS_FILE);

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v) =>
  v === undefined || v === null || String(v).trim() === "" ? NaN : Number(v);

function parseList(value) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string" && value.trim()) {
    const s = value.trim();
    if (s.startsWith("[")) {
      try { items = JSON.parse(s); } catch { items = s.split(","); }
    } else items = s.split(",");
  }
  return items
    .filter((x) => typeof x === "string")
    .map((x) => x.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 20);
}

function newId(list) {
  let id;
  do {
    id = `SOS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  } while (list.some((r) => r.id === id));
  return id;
}

/** Normalise the record inside the list (in place) so it can be updated safely. */
function getForUpdate(list, id) {
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new AppError(404, "SOS request not found.");
  list[i] = logic.normalizeRequest(list[i]);
  return list[i];
}

async function findRequest(id) {
  const found = (await requestStore.read()).find((r) => r.id === id);
  if (!found) throw new AppError(404, "SOS request not found.");
  return logic.normalizeRequest(found);
}

async function findHospital(id) {
  const found = (await hospitalStore.read()).find((h) => h.id === id);
  if (!found) throw new AppError(404, "Hospital not found.");
  return found;
}

/** Adds this hospital's view of the request: distance, readiness, own response. */
function annotate(request, hospital) {
  const m = logic.matchHospitals(request, [hospital])[0];
  return {
    ...request,
    forHospital: {
      distanceKm: m.distanceKm,
      readiness: m.readiness,
      issues: m.issues,
      specialistAvailable: m.specialistAvailable,
      equipmentAvailable: m.equipmentAvailable,
      missingEquipment: m.missingEquipment,
      bedsAvailable: m.bedsAvailable,
      icuAvailable: m.icuAvailable,
      myResponse: request.hospitalResponses.find((r) => r.hospitalId === hospital.id) || null
    }
  };
}

function withAcceptedHospital(request, hospitals) {
  if (!request.acceptedHospitalId) return request;
  const hospital = hospitals.find((h) => h.id === request.acceptedHospitalId);
  if (!hospital) return request;
  const m = logic.matchHospitals(request, [hospital])[0];
  return {
    ...request,
    acceptedHospital: {
      id: hospital.id, name: hospital.name, area: hospital.area || "",
      latitude: hospital.latitude, longitude: hospital.longitude,
      availableBeds: m.availableBeds, icuBeds: m.icuBeds,
      specialists: m.specialists, equipment: m.equipment,
      readiness: m.readiness, issues: m.issues, distanceKm: m.distanceKm
    }
  };
}

// ---------------------------------------------------------------
// Audio upload (validated by extension, MIME type AND file signature)
// ---------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const t = file.mimetype;
      const ext = t.includes("ogg") ? ".ogg" : t.includes("mp4") ? ".mp4"
        : t.includes("mpeg") ? ".mp3" : t.includes("wav") ? ".wav" : ".webm";
      cb(null, `sos-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: MAX_AUDIO_MB * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith("audio/") || file.mimetype === "video/webm";
    cb(ok ? null : new AppError(400, "Please upload a valid audio recording."), ok);
  }
});

async function looksLikeAudio(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const b = Buffer.alloc(12);
    await handle.read(b, 0, 12, 0);
    const head = b.toString("latin1");
    return (
      b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || // webm / matroska
      head.startsWith("OggS") ||
      head.slice(4, 8) === "ftyp" || // mp4 / m4a
      head.startsWith("ID3") ||
      (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || // mp3 frame
      (head.startsWith("RIFF") && head.slice(8, 12) === "WAVE")
    );
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
// Same-origin by default (pages are served by this server). CORS is only
// enabled for origins you list in CORS_ORIGIN.
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : false }));
app.use(express.json({ limit: "1mb" }));

app.use("/uploads", express.static(UPLOAD_DIR, {
  index: false,
  dotfiles: "deny",
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff")
}));
app.use(express.static(PUBLIC_DIR));

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ status: "OK", time: new Date().toISOString() }));

app.get("/api/config", (req, res) => {
  res.json({
    emergencyTypes: logic.EMERGENCY_RULES,
    translation: translator.status(),
    maxAudioMb: MAX_AUDIO_MB
  });
});

app.get("/api/hospitals", async (req, res) => res.json(await hospitalStore.read()));

// Demo hospital staff can change their own availability and capacity.
app.patch("/api/hospitals/:id", async (req, res) => {
  const b = req.body || {};
  const updated = await hospitalStore.update((list) => {
    const h = list.find((x) => x.id === req.params.id);
    if (!h) throw new AppError(404, "Hospital not found.");
    for (const key of ["availableBeds", "icuBeds"]) {
      if (b[key] !== undefined) {
        const n = Number(b[key]);
        if (!Number.isInteger(n) || n < 0 || n > 9999) {
          throw new AppError(400, `${key} must be a whole number from 0 to 9999.`);
        }
        h[key] = n;
      }
    }
    if (b.available !== undefined) {
      if (typeof b.available !== "boolean") throw new AppError(400, "available must be true or false.");
      h.available = b.available;
    }
    return h;
  });
  res.json({ message: "Hospital updated.", hospital: updated });
});

app.get("/api/requests", async (req, res) => {
  let list = (await requestStore.read()).map(logic.normalizeRequest);
  const { hospitalId, ambulanceNumber, status } = req.query;
  if (typeof ambulanceNumber === "string" && ambulanceNumber) {
    list = list.filter((r) => r.ambulanceNumber === ambulanceNumber);
  }
  if (typeof status === "string" && status) {
    list = list.filter((r) => r.status === status.toUpperCase());
  }
  if (typeof hospitalId === "string" && hospitalId) {
    const hospital = await findHospital(hospitalId);
    list = list.map((r) => annotate(r, hospital));
  }
  res.json(list);
});

app.get("/api/requests/:id", async (req, res) => {
  const request = await findRequest(req.params.id);
  res.json(withAcceptedHospital(request, await hospitalStore.read()));
});

// Create an SOS. Accepts multipart/form-data (with optional "audio" file) or JSON.
async function createSOS(req, res) {
  const b = req.body || {};
  const file = req.file;
  try {
    const latitude = num(b.latitude);
    const longitude = num(b.longitude);
    if (!logic.validCoords(latitude, longitude)) {
      throw new AppError(400, "Valid ambulance latitude and longitude are required.");
    }
    const ambulanceNumber = text(b.ambulanceNumber, 40);
    if (!ambulanceNumber) throw new AppError(400, "Ambulance number is required.");

    let age = null;
    if (String(b.age ?? "").trim() !== "") {
      age = Number(b.age);
      if (!Number.isInteger(age) || age < 0 || age > 120) {
        throw new AppError(400, "Age must be a whole number from 0 to 120.");
      }
    }

    const originalTranscript = text(b.originalTranscript ?? b.voiceTranscript, 3000);
    const condition =
      text(b.condition, 1000) ||
      originalTranscript.slice(0, 200) ||
      (file ? "Emergency reported by voice recording" : "");
    if (!condition) {
      throw new AppError(400, "Describe the emergency, record a voice report, or enter a transcript.");
    }

    const emergencyType = text(b.emergencyType, 60) || "Other";
    let requiredSpecialist = text(b.requiredSpecialist, 60);
    let requiredEquipment = parseList(b.requiredEquipment);
    let requirementsSource = "staff";
    if (b.requiredSpecialist === undefined && b.requiredEquipment === undefined) {
      const rule = logic.ruleFor(emergencyType);
      requiredSpecialist = rule ? rule.specialist : "";
      requiredEquipment = rule ? [...rule.equipment] : [];
      requirementsSource = rule ? "demo-rule" : "none";
    }

    if (file && !(await looksLikeAudio(file.path))) {
      throw new AppError(400, "The uploaded file is not a recognised audio recording.");
    }

    const translatedTranscript = text(b.translatedTranscript, 3000);
    const now = new Date().toISOString();
    const record = {
      id: "",
      ambulanceNumber,
      patientName: text(b.patientName, 80) || "Unknown",
      age,
      emergencyType,
      urgency: ["Normal", "High", "Critical"].includes(b.urgency) ? b.urgency : "Normal",
      condition,
      requiredSpecialist,
      requiredEquipment,
      requirementsSource,
      latitude,
      longitude,
      locationSource: ["gps", "demo", "manual"].includes(b.locationSource) ? b.locationSource : "unknown",
      language: text(b.language, 10),
      originalTranscript,
      translatedTranscript,
      translationTarget: translatedTranscript ? text(b.translationTarget, 5) : "",
      translationStatus: translatedTranscript
        ? (["machine", "manual"].includes(b.translationStatus) ? b.translationStatus : "manual")
        : "none",
      voiceRecordingUrl: file ? `/uploads/${file.filename}` : "",
      status: STATUS.PENDING,
      createdAt: now,
      updatedAt: now,
      hospitalResponses: []
    };

    await requestStore.update((list) => {
      record.id = newId(list);
      list.unshift(record);
    });

    const hospitals = await hospitalStore.read();
    const suggestedHospitals = logic.matchHospitals(record, hospitals).slice(0, 3).map((m) => ({
      hospitalId: m.hospitalId, hospitalName: m.hospitalName, readiness: m.readiness,
      score: m.score, distanceKm: m.distanceKm
    }));

    res.status(201).json({
      message: "SOS request created.",
      id: record.id,
      request: record,
      suggestedHospitals
    });
  } catch (error) {
    if (file) await fsp.unlink(file.path).catch(() => {});
    throw error;
  }
}
app.post(["/api/sos", "/api/sos/voice"], upload.single("audio"), createSOS);

// Review / edit the demo requirements while the request is still pending.
app.patch("/api/requests/:id/requirements", async (req, res) => {
  const b = req.body || {};
  const request = await requestStore.update((list) => {
    const r = getForUpdate(list, req.params.id);
    if (r.status !== STATUS.PENDING) {
      throw new AppError(409, "Requirements can only be edited while the request is pending.");
    }
    if (b.requiredSpecialist !== undefined) r.requiredSpecialist = text(b.requiredSpecialist, 60);
    if (b.requiredEquipment !== undefined) r.requiredEquipment = parseList(b.requiredEquipment);
    if (["Normal", "High", "Critical"].includes(b.urgency)) r.urgency = b.urgency;
    r.requirementsSource = "staff-edited";
    r.updatedAt = new Date().toISOString();
    return r;
  });
  res.json({ message: "Requirements updated.", request });
});

app.get("/api/requests/:id/matches", async (req, res) => {
  const request = await findRequest(req.params.id);
  const hospitals = await hospitalStore.read();
  res.json({
    requestId: request.id,
    request,
    requiredSpecialist: request.requiredSpecialist || null,
    requiredEquipment: request.requiredEquipment,
    urgency: request.urgency,
    matches: logic.matchHospitals(request, hospitals)
  });
});

// A hospital accepts or declines. Runs inside the serialized store queue, so
// only ONE concurrent accept can ever win.
app.patch("/api/requests/:id/respond", async (req, res) => {
  const { hospitalId, decision } = req.body || {};
  if (typeof hospitalId !== "string" || !["accepted", "declined"].includes(decision)) {
    throw new AppError(400, "Provide hospitalId and decision (accepted or declined).");
  }
  const hospitals = await hospitalStore.read();
  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) throw new AppError(404, "Hospital not found.");
  const message = text(req.body.message, 300);

  const request = await requestStore.update((list) => {
    const r = getForUpdate(list, req.params.id);
    return logic.applyResponse(r, hospital, decision, message, hospitals.map((h) => h.id));
  });
  res.json({ message: `SOS request ${decision}.`, request });
});

// The ambulance withdraws the request (only while pending).
app.patch("/api/requests/:id/cancel", async (req, res) => {
  const request = await requestStore.update((list) => {
    const r = getForUpdate(list, req.params.id);
    logic.setStatus(r, STATUS.CANCELLED);
    r.cancelledAt = r.updatedAt;
    r.cancelReason = text(req.body?.reason, 300);
    return r;
  });
  res.json({ message: "SOS request cancelled.", request });
});

// The accepting hospital marks the case completed.
app.patch("/api/requests/:id/complete", async (req, res) => {
  const hospitalId = req.body?.hospitalId;
  const request = await requestStore.update((list) => {
    const r = getForUpdate(list, req.params.id);
    if (r.acceptedHospitalId !== hospitalId) {
      throw new AppError(403, "Only the accepting hospital can complete this request.");
    }
    logic.setStatus(r, STATUS.COMPLETED);
    r.completedAt = r.updatedAt;
    return r;
  });
  res.json({ message: "SOS request completed.", request });
});

app.post("/api/translate", async (req, res) => {
  const { text: input, from, to } = req.body || {};
  const clean = text(input, 2000);
  if (!clean) throw new AppError(400, "Provide the text to translate.");
  res.json(await translator.translate(clean, from, to));
});

app.use("/api", (req, res) => res.status(404).json({ message: "API route not found." }));

// ---------------------------------------------------------------
// Errors
// ---------------------------------------------------------------
app.use((error, req, res, next) => {
  if (error instanceof AppError) return res.status(error.status).json({ message: error.message });
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message: error.code === "LIMIT_FILE_SIZE"
        ? `Audio file is too large. Maximum size is ${MAX_AUDIO_MB} MB.`
        : error.message
    });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON." });
  }
  console.error("ResQRoute error:", error);
  res.status(500).json({ message: "Internal server error. See the server console." });
});

app.listen(PORT, () => {
  console.log(`ResQRoute running at http://localhost:${PORT}`);
  console.log(`  Ambulance dashboard : http://localhost:${PORT}/ambulance.html`);
  console.log(`  Hospital dashboard  : http://localhost:${PORT}/index.html`);
  const t = translator.status();
  console.log(`  Translation         : ${t.enabled ? t.provider : "off (manual entry only)"}`);
});
