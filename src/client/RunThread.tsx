import type { ToolProgress } from "./session-state.ts";
import {
  type AuditRow,
  DECISIONS,
  decisionOf,
  handoffOf,
  list,
  ROUTES,
  routeOf,
  ruleName,
  type Tone,
} from "./decision-log.ts";

/** One step of the run as the harness took it, from the audit rows (and the live tools for the step in progress). */
export interface ThreadRow {
  readonly key: string;
  readonly label: string;
  readonly result: string;
  readonly tone?: Tone;
  readonly chips: readonly string[];
  /** A person's decision, drawn as a square node. */
  readonly human?: boolean;
  /** A deterministic rule in our code (the pre-mask), drawn as a small hollow diamond. */
  readonly rule?: boolean;
}

const intakeResult = (detail: string): string =>
  detail === "split"
    ? "Split: health facts stay local, the rest can go to the cloud"
    : detail === "unchanged"
      ? "No health data to split"
      : "Kept local as a whole";

/**
 * The run as rows, oldest first. Consecutive BRANE rows with the same route merge into one, and the pre-mask
 * shows once per set of identifiers, so a turn of five model calls reads as a few lines.
 */
export function threadOf(rows: readonly AuditRow[]): ThreadRow[] {
  const thread: ThreadRow[] = [];
  const masked = new Set<string>();
  const answered = new Set(rows.filter((row) => row.kind === "human").map((row) => row.refId));
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = `row-${row.id}`;
    switch (row.kind) {
      case "intake":
        thread.push({
          key,
          label: "Intake checked the pre-masked claim on BRANE's local model",
          result: intakeResult(row.detail),
          chips: [],
        });
        break;
      case "masked": {
        const ids = list(row.detail).filter((id) => !masked.has(id));
        if (ids.length === 0) break;
        for (const id of ids) masked.add(id);
        thread.push({
          key,
          label: "Pre-mask (regex) replaced identifiers with tokens before BRANE",
          result: "Pattern rules in our code, no model",
          chips: ids,
          rule: true,
        });
        break;
      }
      case "brane": {
        const route = routeOf(row);
        const { label, tone } = ROUTES[route];
        const chips =
          route === "refused"
            ? [ruleName(row.refusedBy)]
            : [...list(row.piiTypes), ...list(row.semanticMatches)];
        const last = thread.at(-1);
        if (last !== undefined && last.label.startsWith("BRANE") && last.result.startsWith(label)) {
          const count = Number(/^BRANE routed (\d+)/.exec(last.label)?.[1] ?? "1") + 1;
          thread[thread.length - 1] = {
            ...last,
            label: `BRANE routed ${count} requests`,
            chips: [...new Set([...last.chips, ...chips])],
          };
          break;
        }
        thread.push({
          key,
          label: "BRANE routed the request",
          result: route === "refused" ? `${label}. Nothing was sent to a model` : label,
          tone,
          chips: [...new Set(chips.filter(Boolean))],
        });
        break;
      }
      case "lookup": {
        const ids = list(row.detail);
        const last = thread.at(-1);
        if (last !== undefined && last.label.startsWith("Searched the policy")) {
          const count = Number(/(\d+) times$/.exec(last.label)?.[1] ?? "1") + 1;
          const chips = [...new Set([...last.chips, ...ids])];
          thread[thread.length - 1] = {
            ...last,
            label: `Searched the policy and the law ${count} times`,
            result: `Found ${chips.length}`,
            chips,
          };
          break;
        }
        thread.push({
          key,
          label: "Searched the policy and the law",
          result: ids.length === 0 ? "No passage matched" : `Found ${ids.length}`,
          chips: ids,
        });
        break;
      }
      case "handoff": {
        const handoff = handoffOf(row);
        if (handoff.tool === "refusal") {
          thread.push({
            key,
            label: "Refusal handed to the claims handler",
            result: answered.has(row.id) ? "Decided below" : "Waiting on their decision",
            tone: answered.has(row.id) ? "passed" : "waiting",
            chips: [ruleName(handoff.value)],
          });
          break;
        }
        thread.push({
          key,
          label:
            handoff.tool === "consult"
              ? `Asked the ${handoff.role.toLowerCase()}`
              : "Recommendation prepared",
          result:
            handoff.tool === "consult"
              ? answered.has(row.id)
                ? "Answered below"
                : "Waiting on their answer"
              : `For the claims handler: ${handoff.sentence.replace(/^.*: /, "")}`,
          tone: answered.has(row.id) ? "passed" : "waiting",
          chips: [],
        });
        break;
      }
      case "human": {
        const decision = decisionOf(row);
        thread.push({
          key,
          label: `${row.actor} decided on handoff #${row.refId}`,
          result: decision === undefined ? row.action : DECISIONS[decision].label,
          ...(decision === undefined ? {} : { tone: DECISIONS[decision].tone }),
          chips: [`audit #${row.id}`],
          human: true,
        });
        break;
      }
    }
  }
  return thread;
}

const PENDING: Record<string, string> = {
  lookup: "Searching the policy and the law",
  consult: "Sending the question to an expert",
  request_approval: "Preparing the recommendation",
};

/** What the harness is doing right now, for the last row while a turn runs. */
export function pendingStep(rows: readonly AuditRow[], tools: readonly ToolProgress[]): string {
  const tool = tools.find((candidate) => candidate.status !== "done");
  if (tool !== undefined) return PENDING[tool.name] ?? `Running ${tool.name}`;
  if (rows.length === 0) return "Intake is checking the pre-masked claim with BRANE's local model";
  return "Waiting for BRANE and the model";
}

interface RunThreadProps {
  readonly rows: readonly AuditRow[];
  readonly tools: readonly ToolProgress[];
  readonly running: boolean;
}

/** The harness at work: one line per step as it happens, each resolving with its result. */
export function RunThread({ rows, tools, running }: RunThreadProps) {
  const thread = threadOf(rows);
  if (thread.length === 0 && !running) return null;
  return (
    <section className="run" aria-label="What the harness did">
      <ol className="run-list" aria-live="polite">
        {thread.map((step) => (
          <li
            key={step.key}
            className={`run-row${step.human === true ? " run-row--human" : ""}${step.rule === true ? " run-row--rule" : ""}`}
          >
            <span
              className={`run-mark${step.tone === "blocked" ? " run-mark--blocked" : ""}`}
              aria-hidden="true"
            />
            <div className="run-text">
              <span className="run-label">{step.label}</span>
              <span
                className={`run-result${step.tone === undefined ? "" : ` run-result--${step.tone}`}`}
              >
                {step.result}
              </span>
              {step.chips.length === 0 ? null : (
                <ul className="chips">
                  {step.chips.map((chip) => (
                    <li key={chip} className="chip">
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
        {running ? (
          <li key="pending" className="run-row run-row--pending">
            <span className="run-mark run-mark--pending" aria-hidden="true" />
            <div className="run-text">
              <span className="run-label">{pendingStep(rows, tools)}…</span>
            </div>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
