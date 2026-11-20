// Classification metrics for routing decisions. Pure functions, no I/O.
// Classes are the four policy outcomes, ranked by strictness: a decision below the expected rank is unsafe,
// one above it is over-strict (safe, but it costs usefulness).

export const CLASSES = ["allow", "protect", "local", "refuse"];
const RANK = { allow: 0, protect: 1, local: 2, refuse: 3 };

/** @param {{expect: string, got: string, leaked?: number}[]} rows */
export function metrics(rows) {
  const confusion = Object.fromEntries(
    CLASSES.map((e) => [e, Object.fromEntries(CLASSES.map((g) => [g, 0]))]),
  );
  let unsafe = 0;
  let overStrict = 0;
  let leaks = 0;
  for (const r of rows) {
    confusion[r.expect][r.got]++;
    leaks += r.leaked ?? 0;
    if (RANK[r.got] < RANK[r.expect] || (r.leaked ?? 0) > 0) unsafe++;
    else if (RANK[r.got] > RANK[r.expect]) overStrict++;
  }
  const perClass = {};
  for (const c of CLASSES) {
    const tp = confusion[c][c];
    const predicted = CLASSES.reduce((n, e) => n + confusion[e][c], 0);
    const actual = CLASSES.reduce((n, g) => n + confusion[c][g], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = actual ? tp / actual : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[c] = { support: actual, precision, recall, f1 };
  }
  const present = CLASSES.filter((c) => perClass[c].support > 0);
  const macroF1 = present.length
    ? present.reduce((s, c) => s + perClass[c].f1, 0) / present.length
    : 0;
  const correct = CLASSES.reduce((n, c) => n + confusion[c][c], 0);
  return {
    n: rows.length,
    accuracy: rows.length ? correct / rows.length : 0,
    macroF1,
    perClass,
    confusion,
    unsafe,
    overStrict,
    leaks,
  };
}

/** Which of the four outcomes a BRANE dry run represents. */
export function outcome(route, prompt, payload, action) {
  if (route === "refused") return "refuse";
  if (route === "local") return "local";
  if (action === "placeholder") return "protect";
  if (action === "allow") return "allow";
  return payload && payload !== prompt ? "protect" : "allow";
}
