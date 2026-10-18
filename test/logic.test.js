const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logic = require("../lib/logic");
const { createStore } = require("../lib/store");

const hospitals = [
  { id: "H1", name: "Near But Limited", latitude: 13.07, longitude: 80.26,
    availableBeds: 5, icuBeds: 0, specialists: ["General Medicine"], equipment: ["ECG"], available: true },
  { id: "H2", name: "Farther And Ready", latitude: 13.15, longitude: 80.30,
    availableBeds: 3, icuBeds: 1, specialists: ["Cardiology"], equipment: ["ECG", "Ventilator"], available: true },
  { id: "H3", name: "Closed", latitude: 13.071, longitude: 80.261,
    availableBeds: 9, icuBeds: 2, specialists: ["Cardiology"], equipment: ["ECG"], available: false }
];
const ids = hospitals.map((h) => h.id);

function pendingRequest(extra = {}) {
  return logic.normalizeRequest({
    id: "SOS-TEST", status: "PENDING", latitude: 13.0701, longitude: 80.2601,
    requiredSpecialist: "Cardiology", requiredEquipment: ["ECG"], urgency: "Normal",
    hospitalResponses: [], ...extra
  });
}

test("allowed and forbidden status transitions", () => {
  assert.ok(logic.canTransition("PENDING", "ACCEPTED"));
  assert.ok(logic.canTransition("PENDING", "CANCELLED"));
  assert.ok(logic.canTransition("ACCEPTED", "COMPLETED"));
  assert.ok(!logic.canTransition("ACCEPTED", "CANCELLED"));
  assert.ok(!logic.canTransition("DECLINED", "ACCEPTED"));
  assert.ok(!logic.canTransition("COMPLETED", "PENDING"));
  const r = pendingRequest({ status: "COMPLETED" });
  assert.throws(() => logic.setStatus(r, "PENDING"), { status: 409 });
});

test("one hospital declining keeps the request open for others", () => {
  const r = pendingRequest();
  logic.applyResponse(r, hospitals[0], "declined", "No cardiologist", ids);
  assert.equal(r.status, "PENDING");
  logic.applyResponse(r, hospitals[1], "accepted", "Send them", ids);
  assert.equal(r.status, "ACCEPTED");
  assert.equal(r.acceptedHospitalId, "H2");
  assert.equal(r.hospitalResponses.length, 2);
});

test("a hospital cannot respond twice", () => {
  const r = pendingRequest();
  logic.applyResponse(r, hospitals[0], "declined", "", ids);
  assert.throws(() => logic.applyResponse(r, hospitals[0], "accepted", "", ids), { status: 409 });
});

test("no responses after acceptance; second accept is rejected", () => {
  const r = pendingRequest();
  logic.applyResponse(r, hospitals[1], "accepted", "", ids);
  assert.throws(() => logic.applyResponse(r, hospitals[0], "accepted", "", ids), { status: 409 });
  assert.equal(r.acceptedHospitalId, "H2");
});

test("request becomes DECLINED only when every hospital has declined", () => {
  const r = pendingRequest();
  logic.applyResponse(r, hospitals[0], "declined", "", ids);
  logic.applyResponse(r, hospitals[1], "declined", "", ids);
  assert.equal(r.status, "PENDING");
  logic.applyResponse(r, hospitals[2], "declined", "", ids);
  assert.equal(r.status, "DECLINED");
});

test("an unavailable hospital cannot accept", () => {
  const r = pendingRequest();
  assert.throws(() => logic.applyResponse(r, hospitals[2], "accepted", "", ids), { status: 409 });
});

test("cancelled requests cannot be accepted", () => {
  const r = pendingRequest();
  logic.setStatus(r, "CANCELLED");
  assert.throws(() => logic.applyResponse(r, hospitals[1], "accepted", "", ids), { status: 409 });
});

test("two simultaneous accepts: exactly one hospital wins", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resq-"));
  const file = path.join(dir, "requests.json");
  fs.writeFileSync(file, JSON.stringify([pendingRequest()]));
  const store = createStore(file);

  const accept = (hospital) =>
    store.update((list) => {
      list[0] = logic.normalizeRequest(list[0]);
      return logic.applyResponse(list[0], hospital, "accepted", "", ids);
    });

  const results = await Promise.allSettled([accept(hospitals[0]), accept(hospitals[1])]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);

  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved[0].status, "ACCEPTED");
  assert.equal(saved[0].hospitalResponses.length, 1);
});

test("a corrupt data file raises an error instead of being overwritten", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resq-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, "{ not json");
  const store = createStore(file);
  await assert.rejects(() => store.read(), /invalid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
});

test("matching: the nearest hospital is not ranked best when it lacks the specialist", () => {
  const matches = logic.matchHospitals(pendingRequest(), hospitals);
  const near = matches.find((m) => m.hospitalId === "H1");
  const ready = matches.find((m) => m.hospitalId === "H2");
  assert.ok(near.distanceKm < ready.distanceKm, "H1 is physically closer");
  assert.equal(ready.readiness, "READY");
  assert.equal(near.readiness, "PARTIAL");
  assert.equal(matches[0].hospitalId, "H2");
  assert.ok(near.issues.some((i) => i.includes("Cardiology")));
});

test("matching: closed hospital is UNAVAILABLE and ranked last; Critical needs an ICU bed", () => {
  const matches = logic.matchHospitals(pendingRequest({ urgency: "Critical" }), hospitals);
  assert.equal(matches.at(-1).hospitalId, "H3");
  assert.equal(matches.at(-1).readiness, "UNAVAILABLE");
  const h2 = matches.find((m) => m.hospitalId === "H2");
  assert.ok(h2.icuAvailable);
  const h1 = matches.find((m) => m.hospitalId === "H1");
  assert.ok(h1.issues.some((i) => i.includes("ICU")));
});

test("distance calculation is sensible", () => {
  const km = logic.haversineKm(13.0827, 80.2707, 13.0604, 80.2496);
  assert.ok(km > 2 && km < 5, `got ${km}`);
  assert.ok(logic.validCoords(13, 80));
  assert.ok(!logic.validCoords(91, 0));
  assert.ok(!logic.validCoords(NaN, 0));
});

test("legacy records are normalised", () => {
  const r = logic.normalizeRequest({
    id: "SOS1", status: "pending", voiceTranscript: "chest pain",
    voiceRecordingUrl: "http://localhost:5000/uploads/a.webm"
  });
  assert.equal(r.status, "PENDING");
  assert.equal(r.originalTranscript, "chest pain");
  assert.equal(r.voiceRecordingUrl, "/uploads/a.webm");
  assert.deepEqual(r.hospitalResponses, []);
});
