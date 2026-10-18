/**
 * ResQRoute core rules: request lifecycle, hospital matching, distance.
 * Pure functions only (no Express, no files), so they are easy to test.
 */

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------
// 1. REQUEST LIFECYCLE
// ---------------------------------------------------------------
const STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED", // only when EVERY hospital has declined
  CANCELLED: "CANCELLED", // withdrawn by the ambulance before acceptance
  COMPLETED: "COMPLETED"
});

const TRANSITIONS = {
  PENDING: ["ACCEPTED", "DECLINED", "CANCELLED"],
  ACCEPTED: ["COMPLETED"],
  DECLINED: [],
  CANCELLED: [],
  COMPLETED: []
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

function setStatus(request, to) {
  if (!canTransition(request.status, to)) {
    throw new AppError(
      409,
      `Cannot change a ${request.status} request to ${to}.`
    );
  }
  request.status = to;
  request.updatedAt = new Date().toISOString();
}

// ---------------------------------------------------------------
// 2. DEMO RULES: emergency type -> specialist / equipment
// These are configurable demo rules. They are NOT a medical diagnosis
// and have NOT been clinically validated. Staff can edit them per request.
// ---------------------------------------------------------------
const EMERGENCY_RULES = [
  { type: "Cardiac / chest pain", specialist: "Cardiology", equipment: ["ECG"] },
  { type: "Stroke / neurological", specialist: "Neurology", equipment: ["CT Scanner"] },
  { type: "Fracture / trauma", specialist: "Orthopedics", equipment: ["X-Ray"] },
  { type: "Breathing difficulty", specialist: "General Medicine", equipment: ["Ventilator"] },
  { type: "General illness", specialist: "General Medicine", equipment: [] },
  { type: "Other", specialist: "", equipment: [] }
];

const ruleFor = (type) => EMERGENCY_RULES.find((r) => r.type === type) || null;

// ---------------------------------------------------------------
// 3. COORDINATES AND DISTANCE
// ---------------------------------------------------------------
const validCoords = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= -90 && lat <= 90 &&
  lon >= -180 && lon <= 180;

/** Straight-line (great-circle) distance in km. NOT a road distance. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
      Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------
// 4. NORMALISING OLD / PARTIAL RECORDS
// ---------------------------------------------------------------
function normalizeRequest(raw) {
  let url = raw.voiceRecordingUrl || "";
  if (/^https?:\/\//i.test(url)) {
    try { url = new URL(url).pathname; } catch { /* keep as is */ }
  }
  return {
    ...raw,
    status: String(raw.status || "PENDING").toUpperCase(),
    urgency: raw.urgency || "Normal",
    emergencyType: raw.emergencyType || "",
    requiredSpecialist: raw.requiredSpecialist || "",
    requiredEquipment: Array.isArray(raw.requiredEquipment) ? raw.requiredEquipment : [],
    originalTranscript: raw.originalTranscript ?? raw.voiceTranscript ?? "",
    translatedTranscript: raw.translatedTranscript || "",
    language: raw.language || "",
    locationSource: raw.locationSource || "unknown",
    voiceRecordingUrl: url,
    hospitalResponses: Array.isArray(raw.hospitalResponses) ? raw.hospitalResponses : []
  };
}

// ---------------------------------------------------------------
// 5. HOSPITAL RESPONSES
// ---------------------------------------------------------------
function applyResponse(request, hospital, decision, message, hospitalIds) {
  if (request.status !== STATUS.PENDING) {
    throw new AppError(
      409,
      request.status === STATUS.ACCEPTED
        ? `This request was already accepted by ${request.acceptedHospitalName}.`
        : `This request is ${request.status} and cannot receive responses.`
    );
  }
  if (request.hospitalResponses.some((r) => r.hospitalId === hospital.id)) {
    throw new AppError(409, "This hospital has already responded to this request.");
  }
  if (decision === "accepted" && hospital.available === false) {
    throw new AppError(409, "This hospital is marked unavailable and cannot accept.");
  }

  const now = new Date().toISOString();
  request.hospitalResponses.push({
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    decision,
    message: message || "",
    respondedAt: now
  });

  if (decision === "accepted") {
    setStatus(request, STATUS.ACCEPTED);
    request.acceptedHospitalId = hospital.id;
    request.acceptedHospitalName = hospital.name;
    request.acceptedAt = now;
  } else if (
    hospitalIds.every((id) =>
      request.hospitalResponses.some((r) => r.hospitalId === id && r.decision === "declined")
    )
  ) {
    setStatus(request, STATUS.DECLINED); // every hospital declined
  } else {
    request.updatedAt = now; // one decline does NOT close the request
  }
  return request;
}

// ---------------------------------------------------------------
// 6. HOSPITAL MATCHING (transparent points, no hidden AI)
//
//  Points (max 100):  availability 10 | beds 10 | specialist 30 |
//                     equipment 30 | ICU 10 | distance 10
//  Readiness label (shown first, points only break ties inside a label):
//    READY       every stated requirement is met
//    PARTIAL     hospital is open with a bed, but a requirement is missing
//    UNAVAILABLE hospital is closed/diverted or has no general bed
//  Distance can never lift a hospital with a missing capability above a
//  hospital that has everything.
// ---------------------------------------------------------------
const READINESS_RANK = { READY: 0, PARTIAL: 1, UNAVAILABLE: 2 };
const asArray = (v) => (Array.isArray(v) ? v : []);

function matchHospitals(request, hospitals) {
  const needSpecialist = request.requiredSpecialist || "";
  const needEquipment = asArray(request.requiredEquipment);
  const needIcu = request.urgency === "Critical";
  const reqLat = Number(request.latitude);
  const reqLon = Number(request.longitude);
  const hasPosition =
    request.latitude !== null && request.longitude !== null && validCoords(reqLat, reqLon);

  const results = hospitals.map((h) => {
    const specialists = asArray(h.specialists);
    const equipment = asArray(h.equipment);
    const available = h.available !== false;
    const beds = Number(h.availableBeds) || 0;
    const icu = Number(h.icuBeds) || 0;

    const specialistAvailable = !needSpecialist || specialists.includes(needSpecialist);
    const missingEquipment = needEquipment.filter((e) => !equipment.includes(e));
    const equipmentAvailable = missingEquipment.length === 0;
    const bedsAvailable = beds > 0;
    const icuAvailable = !needIcu || icu > 0;

    const hLat = Number(h.latitude);
    const hLon = Number(h.longitude);
    const distanceKm =
      hasPosition && validCoords(hLat, hLon)
        ? Math.round(haversineKm(reqLat, reqLon, hLat, hLon) * 10) / 10
        : null;

    const issues = [];
    if (!available) issues.push("Hospital is marked unavailable");
    if (!bedsAvailable) issues.push("No general bed available");
    if (!specialistAvailable) issues.push(`No ${needSpecialist} specialist listed`);
    if (!equipmentAvailable) issues.push(`Missing equipment: ${missingEquipment.join(", ")}`);
    if (!icuAvailable) issues.push("No ICU bed (request marked Critical)");

    const readiness = !available || !bedsAvailable
      ? "UNAVAILABLE"
      : issues.length ? "PARTIAL" : "READY";

    const eqPoints = needEquipment.length
      ? Math.round((30 * (needEquipment.length - missingEquipment.length)) / needEquipment.length)
      : 30;
    const distPoints = distanceKm === null ? 0 : Math.max(0, Math.round(10 - distanceKm / 2));

    const breakdown = [
      { label: "Hospital available", points: available ? 10 : 0, max: 10,
        note: available ? "Open to emergencies" : "Marked unavailable" },
      { label: "General bed", points: bedsAvailable ? 10 : 0, max: 10,
        note: `${beds} bed(s) listed` },
      { label: "Specialist", points: specialistAvailable ? 30 : 0, max: 30,
        note: needSpecialist ? (specialistAvailable ? `${needSpecialist} listed` : `${needSpecialist} not listed`) : "None required" },
      { label: "Equipment", points: eqPoints, max: 30,
        note: needEquipment.length ? (equipmentAvailable ? "All required equipment listed" : `Missing ${missingEquipment.join(", ")}`) : "None required" },
      { label: "ICU bed", points: icuAvailable ? 10 : 0, max: 10,
        note: needIcu ? `${icu} ICU bed(s) listed` : "Not required for this urgency" },
      { label: "Distance", points: distPoints, max: 10,
        note: distanceKm === null ? "Distance unknown" : `${distanceKm} km straight line (10 points at 0 km, 0 at 20 km or more)` }
    ];

    return {
      hospitalId: h.id,
      hospitalName: h.name,
      area: h.area || "",
      latitude: h.latitude,
      longitude: h.longitude,
      availableBeds: beds,
      icuBeds: icu,
      specialists,
      equipment,
      available,
      specialistAvailable,
      equipmentAvailable,
      missingEquipment,
      bedsAvailable,
      icuAvailable,
      distanceKm,
      issues,
      readiness,
      ready: readiness === "READY",
      score: breakdown.reduce((sum, b) => sum + b.points, 0),
      breakdown
    };
  });

  results.sort((a, b) =>
    READINESS_RANK[a.readiness] - READINESS_RANK[b.readiness] ||
    b.score - a.score ||
    (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
  );
  results.forEach((m, i) => { m.rank = i + 1; });
  return results;
}

module.exports = {
  AppError, STATUS, TRANSITIONS, canTransition, setStatus,
  EMERGENCY_RULES, ruleFor, validCoords, haversineKm,
  normalizeRequest, applyResponse, matchHospitals
};
