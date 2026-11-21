#!/usr/bin/env node
// Write evals/golden/health.jsonl, a dev suite of varied synthetic health claims, 13 claim shapes times 3 variants.
// Each row carries different data (BSN, IBAN, birth date, ICD-10 code, medicine with ATC code, doctor and clinic
// names, a third party's health) and lists every span that must not leave, with its category, plus the expected route.
// Entities come from Omar Shalaby's dev pools (omar/data/generator/compose.py, POOLS.dev: names, cities, banks, BSNs)
// so no person, IBAN or id is shared with his locked test set; wording stays inside his vocabulary split's Half A
// (omar/data/vocab_split.json), and the script fails if a Half B (test-only) term appears. It is seeded, so every run
// writes the same file.
// Usage: node evals/generate-health.mjs [--check]   (--check verifies the committed file without writing)
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "evals/golden/health.jsonl";
// A seeded random number generator (mulberry32).
let seed = 20261121;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// Omar's dev pools.
const FIRST = [
  "Jan",
  "Sanne",
  "Pieter",
  "Lotte",
  "Femke",
  "Koen",
  "Noor",
  "Sem",
  "Tess",
  "Joost",
  "Anke",
  "Gerrit",
  "Hanneke",
  "Mart",
  "Yara",
  "Stijn",
];
const LAST = [
  "de Vries",
  "Bakker",
  "Jansen",
  "Meijer",
  "de Boer",
  "Bos",
  "Vos",
  "van Leeuwen",
  "Dekker",
  "Kramer",
  "Hermans",
  "Wolters",
  "Jacobs",
  "Peeters",
  "El Amrani",
  "Yilmaz",
];
const CITY = ["Maastricht", "Heerlen", "Venlo", "Sittard", "Roermond", "Weert", "Kerkrade"];
const STREET = ["Kerkstraat", "Stationsweg", "Molenweg", "Brugstraat", "Markt", "Hoogstraat"];
const BANKS = ["ABNA", "INGB", "RABO"];
const BSN = ["111222333", "187765546", "417395176", "493938382", "570481594", "647024809"];
// Fictional care providers and doctors.
const CLINIC = [
  "Sint Servaas Kliniek",
  "Maasland Ziekenhuis",
  "Heuvelland Medisch Centrum",
  "Kliniek De Geul",
  "Mergelland Kliniek",
];
const ABROAD = [
  "Clínica Costa Azul in Faro",
  "Hospital San Rafael in Málaga",
  "Landeskrankenhaus Zillertal",
  "Ospedale Lago Blu in Verona",
];
const DOCTOR = [
  "dr. Hendriks",
  "dr. Claessen",
  "dr. Aarts",
  "dr. Franssen",
  "dr. Lemmens",
  "dr. Ramakers",
];

const iban = () => {
  const bban = `${pick(BANKS)}${String(int(0, 9999999999)).padStart(10, "0")}`;
  const n = BigInt([...`${bban}NL00`].map((ch) => parseInt(ch, 36)).join(""));
  return `NL${String(98n - (n % 97n)).padStart(2, "0")}${bban}`;
};
const date = () =>
  `${int(1, 28)} ${pick(["January", "February", "March", "April", "May", "June", "September", "October"])} 2026`;
const birth = () =>
  `${String(int(1, 28)).padStart(2, "0")}-${String(int(1, 12)).padStart(2, "0")}-${int(1962, 1999)}`;

function claim(build) {
  const spans = [];
  const carries = new Set();
  // S registers a span that must not leave and returns its text.
  const S = (cat, text) => {
    if (!spans.some((s) => s.text === text)) spans.push({ text, cat });
    carries.add(cat);
    return text;
  };
  const e = {
    S,
    name: () => S("PERSON", `${pick(FIRST)} ${pick(LAST)}`),
    bsn: () => S("BSN", pick(BSN)),
    iban: () => S("IBAN", iban()),
    birth: () => S("DATE_OF_BIRTH", birth()),
    policy: () => S("POLICY_ID", `POL-${int(1000, 4999)}-${int(10, 99)}`),
    claimId: () => S("CLAIM_ID", `CLM-2026-${int(1000, 4999)}`),
    clinic: () => S("HEALTH_PROVIDER", pick(CLINIC)),
    abroad: () => S("HEALTH_PROVIDER", pick(ABROAD)),
    doctor: () => S("HEALTH_PROVIDER", pick(DOCTOR)),
    health: (t) => S("HEALTH", t),
    code: (t) => S("DIAGNOSIS_CODE", t),
    med: (t) => S("MEDICINE", t),
    third: (t) => S("THIRD_PARTY_HEALTH", t),
    address: () => S("ADDRESS", `${pick(STREET)} ${int(1, 180)}, ${pick(CITY)}`),
    email: (n) => S("EMAIL", `${n.toLowerCase().replace(/[^a-z]+/g, ".")}@example.nl`),
    date,
    eur: (a, b) => `EUR ${int(a, b).toLocaleString("en-US")}`,
  };
  const text = build(e);
  return { text, spans, carries: [...carries].sort() };
}

// Thirteen shapes. Each returns one claim text; variants differ in people, amounts and the data the claim carries.
const SHAPES = {
  "physiotherapy-series": (e, v) =>
    `Synthetic claim ${e.claimId()}, policy ${e.policy()}: ${e.name()}${v === 1 ? `, born ${e.birth()},` : ""} claims ${[12, 18, 9][v]} physiotherapy sessions at ${e.eur(34, 42)} each after ${e.health(["whiplash from a rear-end collision", "a lumbar hernia", "a fracture of the left ankle"][v])}${v === 2 ? ` (ICD-10 ${e.code("S82.6")})` : ""}. Referral by ${e.doctor()} dated ${e.date()} is attached. Check the sessions against the policy limit and prepare a recommendation.`,
  "dental-crown": (e, v) =>
    `Synthetic claim ${e.claimId()}: ${e.name()} had ${e.health(["a crown placed on a lower molar", "a root canal and a crown on an upper molar", "two crowns after a cycling fall chipped her front teeth"][v])} at ${e.clinic()}. Invoice ${e.eur(480, 1350)}, to be paid to ${e.iban()}.${v === 0 ? ` Policy ${e.policy()}.` : ""} Is dental treatment covered under the supplementary package?`,
  "mental-health-medication": (e, v) =>
    `Synthetic claim, policy ${e.policy()}: ${e.name()}${v === 0 ? ` (BSN ${e.bsn()})` : ""} has been treated for ${e.health(["burnout", "depression", "an anxiety disorder"][v])}${v === 1 ? ` (ICD-10 ${e.code("F32.1")})` : ""} since ${e.date()} and takes ${e.med("sertraline (ATC N06AB06)")}. Claimed: ${[8, 12, 10][v]} sessions with ${e.health("a registered psychologist")}, ${e.eur(700, 1400)}. ${["A GP referral is attached.", "No referral is in the file.", "The referral is dated after the first session."][v]} Prepare the intake summary for the medical adviser.`,
  maternity: (e, v) =>
    `Synthetic claim ${e.claimId()}: ${e.name()}, born ${e.birth()}, is ${e.health(["20 weeks pregnant", "pregnant with twins", "pregnant and under care of a midwife"][v])} and claims ${["two routine ultrasounds", "an extra growth scan and a consultation", "antenatal checks and a home birth kit"][v]} for ${e.eur(140, 520)}.${v === 2 ? ` Care by ${e.doctor()} at ${e.clinic()}.` : ""} Do these count toward the own risk?`,
  "chronic-repeat-prescription": (e, v) =>
    `Synthetic claim, policy ${e.policy()}: ${e.name()}${v === 2 ? ` (BSN ${e.bsn()})` : ""} has ${e.health(["high blood pressure", "an underactive thyroid", "chronic migraine"][v])} (ICD-10 ${e.code(["I10", "E03.9", "G43.9"][v])}) and claims the repeat prescription of ${e.med(["amlodipine (ATC C08CA01)", "levothyroxine (ATC H03AA01)", "sumatriptan (ATC N02CC01)"][v])} for the last quarter, ${e.eur(28, 96)}, prescribed by ${e.doctor()}. Payout to ${e.iban()}. Check the claim for completeness.`,
  "emergency-abroad-ehic": (e, v) =>
    `Synthetic travel claim ${e.claimId()}, policy ${e.policy()}: on holiday ${e.name()} ${e.health(["broke a wrist in a fall", "had surgery after a ski fracture of the lower leg", "was treated for a deep cut that needed stitches"][v])} and was treated at ${e.abroad()}. Invoice ${e.eur(900, 4200)}. ${["A valid EHIC was shown.", "No EHIC was shown; the emergency line was called after 60 hours.", "A valid EHIC was shown and the emergency line was called the same day."][v]} What is covered?`,
  "ambulance-transport": (e, v) =>
    `Synthetic claim ${e.claimId()}: ${e.name()} was taken by ambulance to ${e.clinic()} on ${e.date()} after ${e.health(["collapsing at work with chest pain", "a fall from a ladder with a suspected hip fracture", "a severe allergic reaction"][v])}. Ambulance invoice ${e.eur(320, 780)}.${v === 1 ? ` Date of birth ${e.birth()}.` : ""}${v === 2 ? ` Reimburse to ${e.iban()}.` : ""} Check the invoice against the policy.`,
  "hospital-stay-named-clinic": (e, v) =>
    `Synthetic claim, policy ${e.policy()}: ${e.name()} was admitted to ${e.clinic()} for ${[3, 5, 2][v]} nights for ${e.health(["hernia surgery", "an operation on the gall bladder", "observation after a fracture of two ribs"][v])}${v === 0 ? ` (ICD-10 ${e.code("K40.9")})` : ""}, treating specialist ${e.doctor()}. Total ${e.eur(2800, 7400)}. ${["The clinic is contracted.", "The clinic is not contracted and it was not an emergency.", "The clinic is not contracted; admission was through the emergency department."][v]} Prepare a recommendation.`,
  "minor-claim-by-parent": (e, v) => {
    const parent = e.name();
    return `Synthetic claim ${e.claimId()} submitted by ${parent} (${e.email(parent)}) for a child: ${e.third(["her son Sem, 9, broke his arm on the playground", "his daughter Noor, 6, had grommets placed for recurring ear infections", "their son Koen, 14, sees a psychologist for anxiety"][v])}${v === 0 ? ` and was treated at ${e.clinic()}` : ""}. Child's date of birth ${e.birth()}. Invoice ${e.eur(180, 1600)}. Costs for children under 18: does the own risk apply?`;
  },
  "deceased-policyholder": (e, v) => {
    const heir = e.name();
    return `Synthetic claim, policy ${e.policy()}: ${heir} writes as ${["daughter", "executor", "widower"][v]} of the late policyholder ${e.name()} (BSN ${e.bsn()}), who died on ${e.date()}. Outstanding invoices from ${e.clinic()} for ${e.third(["chemotherapy in the last three months", "oncology treatment and a hospital stay", "intensive care after surgery"][v])}, ${e.eur(3200, 9800)}. Payout requested to ${e.iban()}${v === 1 ? `, address ${e.address()}` : ""}. Which documents does the handler need from the relative?`;
  },
  "ocr-medical-report": (e, v) =>
    `Summarise the attached scan for the claims file.\n\n--- OCR text ---\nMED1SCH VERSLAG   ${e.clinic()}\nPati\u00ebnt: ${e.name()}   geb. ${e.birth()}${v !== 1 ? `   BSN ${e.bsn()}` : ""}\nBehandelaar: ${e.doctor()}\nD1agnose: ${e.health(["fractuur distale radius links", "hernia nuclei pulposi L4-L5", "depressieve stoornis, matig"][v])} (ICD-10 ${e.code(["S52.5", "M51.1", "F32.1"][v])})\nMedicatie: ${e.med(["paracetamol 1000 mg (ATC N02BE01)", "diclofenac 50 mg (ATC M01AB05)", "sertraline 50 mg (ATC N06AB06)"][v])}\nAdvies: ${["6 weken gips, controle na 2 weken", "fysiotherapie, 12 behandelingen", "vervolg bij psycholoog, 8 sessies"][v]}\n--- end ---`,
  "mixed-travel-health": (e, v) =>
    `Synthetic travel claim ${e.claimId()}, policy ${e.policy()}: ${e.name()} cut a trip short. Items: ${["suitcase lost by the airline EUR 640", "cancelled hotel nights EUR 410", "stolen camera EUR 520"][v]}; ${["rebooked flight EUR 280", "ski pass refund EUR 150", "taxi to the airport EUR 95"][v]}; and treatment at ${e.abroad()} for ${e.health(["a fracture of the collarbone", "whiplash after a bus accident", "surgery on a torn knee tendon"][v])}, ${e.eur(700, 3100)}.${v === 2 ? ` Travel companion: ${e.third("her partner was also injured and stayed in hospital two nights")}.` : ""} Split the claim into travel and medical items and say what each needs.`,
  "dutch-language": (e, v) =>
    `Synthetische claim ${e.claimId()}, polis ${e.policy()}: ${e.name()}${v === 0 ? ` (BSN ${e.bsn()})` : ""} ${e.health(["heeft bij een val de pols gebroken en is geopereerd", "is sinds de zomer overspannen en wordt begeleid door de huisarts", "is zwanger en heeft een extra echo laten maken"][v])} in ${e.clinic()}. Factuur ${e.eur(160, 2900)}, uit te betalen op ${e.iban()}.${v === 1 ? ` Medicatie: ${e.med("sertraline (ATC N06AB06)")}.` : ""} Controleer de factuur aan de hand van de polisvoorwaarden.`,
};

const rows = [];
for (const [kind, build] of Object.entries(SHAPES))
  for (let v = 0; v < 3; v++) {
    const c = claim((e) => build(e, v));
    rows.push({
      id: `h-${kind}-${v + 1}`,
      kind,
      lang: kind === "dutch-language" ? "nl" : kind === "ocr-medical-report" ? "en+nl" : "en",
      text: c.text,
      // A specific person's health detail: the whole turn stays on the local model.
      expect: "local",
      carries: c.carries,
      spans: c.spans,
    });
  }

// The vocabulary guard follows the rule in omar/eval/check_leakage.py: no Half B (test-only) term in a tuning row.
const halfB = Object.values(JSON.parse(readFileSync("omar/data/vocab_split.json", "utf8")).half_b)
  .flat()
  .map((t) => t.replace(/\s*\(.*?\)\s*$/, "").trim());
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hits = [];
for (const r of rows)
  for (const t of halfB) {
    const re = new RegExp(
      `(?<![\\w])${escape(t)}(?:s|es|en|e|n)?(?![a-zà-ÿß])`,
      /^[A-Z]/.test(t) ? "" : "i",
    );
    if (re.test(r.text)) hits.push(`${r.id}: ${t}`);
  }
if (hits.length)
  throw new Error(`Half B (test-only) terms in the health suite:\n  ${hits.join("\n  ")}`);
// Every span must be in its text, or the grader could never see it leak.
for (const r of rows)
  for (const s of r.spans)
    if (!r.text.includes(s.text)) throw new Error(`${r.id}: span not in text: ${s.text}`);

const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== body)
    throw new Error(`${OUT} differs from the generator's output`);
  console.log(`${OUT} matches the generator`);
} else writeFileSync(OUT, body);
const cats = {};
for (const r of rows) for (const s of r.spans) cats[s.cat] = (cats[s.cat] ?? 0) + 1;
console.log(
  `${rows.length} health claims, ${rows.reduce((n, r) => n + r.spans.length, 0)} must-not-leave spans, 0 of ${halfB.length} Half B terms`,
  cats,
);
