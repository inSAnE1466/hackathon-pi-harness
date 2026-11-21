import { BRANE_CLOUD_MODEL, BRANE_LOCAL_MODEL } from "./brane.ts";
import { sha256 } from "./sha256.ts";

/**
 * Harness switches: what an eval run can change about one session without a code edit. Set when the session is
 * created (`POST /api/sessions` with `{switches}`) or later (`PUT /api/sessions/:id/switches`); stored in the
 * session's SQLite; read at every model request, so a change applies from the next request. None of them opens a
 * route around BRANE: every model request still goes through the gated provider.
 */
export type Switches = {
  /** Split health detail out on the local model before the agent's turn. */
  readonly intake: "on" | "off";
  /** `preflight`: a BRANE dry run of the prompt before the turn (intake needs it). `inline`: the chat call only. */
  readonly braneTiming: "preflight" | "inline";
  /** The model the agent asks BRANE for. BRANE still moves a request to its local model when the policy says so. */
  readonly cloudModel: string;
  /** The local model for intake's extraction. */
  readonly localModel: string;
  readonly promptVariant: PromptVariant;
  /** Replaces the variant's instructions when not empty. */
  readonly instructions: string;
  /** The tools offered to the model, by name. */
  readonly tools: readonly ToolName[];
};

export const TOOL_NAMES = ["lookup", "web_read", "consult", "request_approval"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const PROMPT_VARIANTS = ["default", "minimal", "strict"] as const;
export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

export const DEFAULT_SWITCHES: Switches = {
  intake: "on",
  braneTiming: "preflight",
  cloudModel: BRANE_CLOUD_MODEL,
  localModel: BRANE_LOCAL_MODEL,
  promptVariant: "default",
  instructions: "",
  tools: TOOL_NAMES,
};

const MAX_INSTRUCTIONS_CHARACTERS = 8_000;
const MODEL_ID = /^(openrouter|vllm):[\w.\-/:]{1,100}$/;

export type SwitchesResult =
  | { readonly ok: true; readonly switches: Switches }
  | { readonly ok: false; readonly error: string };

const oneOf = <T extends string>(
  key: string,
  value: unknown,
  options: readonly T[],
): T | { error: string } =>
  options.includes(value as T)
    ? (value as T)
    : { error: `${key} must be one of: ${options.join(", ")}` };

/** Applies a partial change to `current`. An unknown key or a bad value rejects the whole change. */
export function applySwitches(current: Switches, change: unknown): SwitchesResult {
  if (typeof change !== "object" || change === null || Array.isArray(change))
    return { ok: false, error: "switches must be a JSON object" };
  const next: { -readonly [K in keyof Switches]: Switches[K] } = { ...current };
  for (const [key, value] of Object.entries(change)) {
    switch (key) {
      case "intake": {
        const v = oneOf(key, value, ["on", "off"] as const);
        if (typeof v === "object") return { ok: false, ...v };
        next.intake = v;
        break;
      }
      case "braneTiming": {
        const v = oneOf(key, value, ["preflight", "inline"] as const);
        if (typeof v === "object") return { ok: false, ...v };
        next.braneTiming = v;
        break;
      }
      case "promptVariant": {
        const v = oneOf(key, value, PROMPT_VARIANTS);
        if (typeof v === "object") return { ok: false, ...v };
        next.promptVariant = v;
        break;
      }
      case "cloudModel":
      case "localModel":
        if (typeof value !== "string" || !MODEL_ID.test(value))
          return {
            ok: false,
            error: `${key} must be a BRANE model id (openrouter:... or vllm:...)`,
          };
        next[key] = value;
        break;
      case "instructions":
        if (typeof value !== "string" || value.length > MAX_INSTRUCTIONS_CHARACTERS)
          return {
            ok: false,
            error: `instructions must be text of at most ${MAX_INSTRUCTIONS_CHARACTERS} characters`,
          };
        next.instructions = value;
        break;
      case "tools": {
        const names =
          typeof value === "string"
            ? value
                .split(",")
                .map((name) => name.trim())
                .filter((name) => name !== "")
            : value;
        if (
          !Array.isArray(names) ||
          !names.every((name) => TOOL_NAMES.includes(name as ToolName)) ||
          new Set(names).size !== names.length
        )
          return { ok: false, error: `tools must be a list from: ${TOOL_NAMES.join(", ")}` };
        // Registry order, so the same set always renders the same request.
        next.tools = TOOL_NAMES.filter((name) => names.includes(name));
        break;
      }
      default:
        return { ok: false, error: `unknown switch: ${key}` };
    }
  }
  return { ok: true, switches: next };
}

/** The switches as the audit log records them: free-text instructions as a hash, never the text. */
export const switchesForAudit = (s: Switches): string =>
  JSON.stringify({
    ...s,
    instructions: s.instructions === "" ? "" : `sha256:${sha256(s.instructions).slice(0, 16)}`,
  });

/** The stored switches of one session, in its own table beside the audit log. */
export class SwitchStore {
  readonly #sql: SqlStorage;
  #current: Switches;

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS harness_switches (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`,
    );
    const row = sql.exec(`SELECT json FROM harness_switches WHERE id = 1`).toArray()[0];
    let stored: unknown = {};
    try {
      if (row !== undefined) stored = JSON.parse(String(row.json));
    } catch {
      // An unreadable row falls back to the defaults.
    }
    const result = applySwitches(DEFAULT_SWITCHES, stored);
    this.#current = result.ok ? result.switches : DEFAULT_SWITCHES;
  }

  get current(): Switches {
    return this.#current;
  }

  set(change: unknown): SwitchesResult {
    const result = applySwitches(this.#current, change);
    if (!result.ok) return result;
    this.#sql.exec(
      `INSERT INTO harness_switches (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json`,
      JSON.stringify(result.switches),
    );
    this.#current = result.switches;
    return result;
  }
}
