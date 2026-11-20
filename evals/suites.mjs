// The QC suites and how to compare two scores. qc.mjs and climb.mjs both score through here, so the gate and the
// climb judge a policy by the same worst-of-N numbers.
import { execFile } from "node:child_process";

// Golden sets graded worst of N: a claim passes only if every run passed. N is per set; the mutated set is five
// times larger, so it runs twice instead of three times.
export const SETS = [
  { suite: "golden", args: [], runs: 3 },
  { suite: "heldout", args: ["--set=heldout"], runs: 3 },
  { suite: "mutated", args: ["--set=mutated", "--harness"], runs: 2 },
];
// Higher is better for "passed"; lower is better for everything else.
const lowerIsBetter = new Set(["leaked", "overBlocked"]);

// Children in flight, so a signal handler can kill them before it restores the policy.
const active = new Set();
export const killChildren = () => {
  for (const child of active) child.kill("SIGKILL");
};

// Run a node script with a hard timeout. A timeout or crash yields ok=false and whatever stdout arrived.
export function node(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(
      "node",
      args,
      { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        active.delete(child);
        resolve({ out: String(stdout ?? ""), ok: !error, timedOut: error?.killed === true });
      },
    );
    active.add(child);
  });
}

const NAN = [Number.NaN, Number.NaN];

// Score every suite. deadline (ms since epoch) bounds the whole call: each child gets what is left, at most
// perChildMs. Returns { results, details, seconds }: details holds each golden set's per-claim JSON, seconds each
// suite's wall time. cache passes --cache to golden.mjs; the climb never caches, its confirmation needs fresh runs.
export async function scoreSuites({
  deadline = Infinity,
  perChildMs = 600_000,
  agentUrl,
  cache = false,
} = {}) {
  const budget = () => Math.max(1_000, Math.min(perChildMs, deadline - Date.now()));
  const results = {};
  const details = {};
  const seconds = {};
  for (const { suite, args, runs } of SETS) {
    const t = Date.now();
    const r = await node(
      [
        "evals/golden.mjs",
        ...args,
        "--runs",
        String(runs),
        "--json",
        ...(cache ? ["--cache"] : []),
      ],
      budget(),
    );
    seconds[suite] = Math.round((Date.now() - t) / 1000);
    let parsed;
    try {
      parsed = JSON.parse(r.out);
    } catch {
      parsed = undefined;
    }
    details[suite] = parsed;
    results[suite] = parsed
      ? {
          passed: parsed.summary.passed,
          leaked: parsed.summary.leaked,
          overBlocked: parsed.summary.overBlocked,
        }
      : { passed: NAN, leaked: NAN, overBlocked: NAN };
  }
  let t = Date.now();
  const cases = (await node(["scripts/brane-cases.mjs"], budget())).out;
  seconds.organizers = Math.round((Date.now() - t) / 1000);
  const m = /(\d+)\/(\d+) pass/.exec(cases);
  results.organizers = { passed: m ? [Number(m[1]), Number(m[2])] : NAN };
  if (agentUrl) {
    t = Date.now();
    const agent = (await node(["evals/agent.mjs", agentUrl], budget())).out;
    seconds.agent = Math.round((Date.now() - t) / 1000);
    const a = /(\d+)\/(\d+) agent cases pass/.exec(agent);
    results.agent = { passed: a ? [Number(a[1]), Number(a[2])] : NAN };
  }
  return { results, details, seconds };
}

// Compare a score with a reference, metric by metric. A missing or unparsable number counts as worse.
export function compare(after, before) {
  const rows = [];
  for (const [suite, metrics] of Object.entries(after)) {
    for (const [metric, [value, total]] of Object.entries(metrics)) {
      const ref = before?.[suite]?.[metric]?.[0];
      const broken = Number.isNaN(value);
      const known = ref !== undefined && !Number.isNaN(ref);
      const worse = broken || (known && (lowerIsBetter.has(metric) ? value > ref : value < ref));
      const better = !broken && known && (lowerIsBetter.has(metric) ? value < ref : value > ref);
      rows.push({ suite, metric, value, total, ref, worse, better });
    }
  }
  return {
    rows,
    worse: rows.filter((r) => r.worse),
    better: rows.filter((r) => r.better),
  };
}

// The worse of two scores, metric by metric: used to confirm a candidate with a second measurement.
export function worstOf(a, b) {
  const out = {};
  for (const [suite, metrics] of Object.entries(a)) {
    out[suite] = {};
    for (const [metric, [value, total]] of Object.entries(metrics)) {
      const other = b?.[suite]?.[metric]?.[0];
      const pick =
        Number.isNaN(value) || Number.isNaN(other)
          ? Number.NaN
          : lowerIsBetter.has(metric)
            ? Math.max(value, other)
            : Math.min(value, other);
      out[suite][metric] = [pick, total];
    }
  }
  return out;
}

export const fmt = (results) =>
  Object.entries(results)
    .map(
      ([suite, ms]) =>
        `${suite}[${Object.entries(ms)
          .map(([k, [v, t]]) => `${k} ${v}/${t}`)
          .join(", ")}]`,
    )
    .join(" ");
