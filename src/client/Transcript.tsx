import type { ReactNode } from "react";
import type { ToolDiagnostic } from "@earendil-works/pi-durable";
import { ClaimMessage } from "./ClaimMessage.tsx";
import { parseClaimText } from "./queue.ts";
import type {
  TranscriptEntry,
  TranscriptGap,
  TranscriptToolCall,
  ToolProgress,
} from "./session-state.ts";
import {
  type AuditRow,
  DECISIONS,
  handoffFor,
  humanMessageOf,
  type HumanMessage,
  passageIds,
  refusalOf,
} from "./decision-log.ts";
import { Markdown } from "./Markdown.tsx";
import { RefusalCard } from "./RefusalCard.tsx";

interface TranscriptListProps {
  readonly entries: readonly TranscriptEntry[];
  /** Missing ranges, each shown after the entry it follows. */
  readonly gaps?: readonly TranscriptGap[];
  readonly tools: readonly ToolProgress[];
  readonly runActive: boolean;
  /** The session's decision log, newest first, to name the rule behind a refused model call. */
  readonly auditRows?: readonly AuditRow[];
  readonly onFork?: (entryId: number) => void;
  readonly onFillGap?: (gap: TranscriptGap) => void;
  /** Shown right after the first user message, e.g. the run's activity thread. */
  readonly afterFirstPrompt?: ReactNode;
}

export function TranscriptList({
  entries,
  gaps = [],
  tools,
  runActive,
  auditRows = [],
  onFork,
  onFillGap,
  afterFirstPrompt,
}: TranscriptListProps) {
  const { resultsByRequest, groupedResultIds } = correlateToolResults(entries);
  const progress = new Map(tools.map((tool) => [tool.callId, tool]));
  const gapsAfter = new Map<number, TranscriptGap>(gaps.map((gap) => [gap.after, gap]));
  const firstPromptId = entries.find((entry) => entry.role === "user")?.id;

  return (
    <ol className="transcript-list">
      {entries.flatMap((entry) => {
        const gap = gapsAfter.get(entry.id);
        const row = transcriptRow(entry);
        const after =
          entry.id === firstPromptId && afterFirstPrompt !== undefined
            ? [<li key="after-first-prompt">{afterFirstPrompt}</li>]
            : [];
        return gap === undefined
          ? [row, ...after]
          : [
              row,
              ...after,
              <li key={`gap-${gap.after}`}>
                <button
                  className="text-button transcript-load"
                  type="button"
                  onClick={() => onFillGap?.(gap)}
                >
                  Load missing messages
                </button>
              </li>,
            ];
      })}
    </ol>
  );

  function transcriptRow(entry: TranscriptEntry) {
    if (groupedResultIds.has(entry.id)) return null;

    if (entry.toolCalls !== undefined && entry.toolCalls.length > 0) {
      const results = resultsByRequest.get(entry.id);
      return (
        <li className="transcript-turn" key={entry.id}>
          {entry.text.length > 0 ? (
            <TranscriptMessage
              entry={entry}
              onFork={onFork === undefined ? undefined : () => onFork(entry.id)}
            />
          ) : (
            <ToolRequest
              entry={entry}
              onFork={onFork === undefined ? undefined : () => onFork(entry.id)}
            />
          )}
          <ol className="tool-executions" aria-label="Tool calls">
            {entry.toolCalls.map((call) => (
              <li key={call.callId}>
                <ToolExecution
                  call={call}
                  progress={progress.get(call.callId)}
                  result={results?.get(call.callId)}
                  runActive={runActive}
                />
              </li>
            ))}
          </ol>
        </li>
      );
    }

    if (entry.toolResult !== undefined) {
      return (
        <li key={entry.id}>
          <ToolExecution
            call={{
              callId: entry.toolResult.callId,
              name: entry.toolResult.name,
              args: {},
            }}
            result={entry}
            runActive={false}
            showArguments={false}
          />
        </li>
      );
    }

    const refusal = entry.role === "assistant" ? refusalOf(entry.text, auditRows) : undefined;
    if (refusal !== undefined) {
      return (
        <li key={entry.id}>
          <RefusalCard refusal={refusal} />
        </li>
      );
    }

    return (
      <li key={entry.id}>
        <TranscriptMessage
          entry={entry}
          onFork={onFork === undefined ? undefined : () => onFork(entry.id)}
        />
      </li>
    );
  }
}

/** The harness prefixes each prompt with its speaker as `[name]\n`; show the name as the label instead. */
function speakerOf(entry: TranscriptEntry): { readonly label: string; readonly text: string } {
  const label = roleLabel[entry.role];
  if (entry.role !== "user") return { label, text: entry.text };
  const match = /^\[([^\]\n]{1,40})\]\n/.exec(entry.text);
  return match === null
    ? { label, text: entry.text }
    : { label: match[1], text: entry.text.slice(match[0].length) };
}

function correlateToolResults(entries: readonly TranscriptEntry[]): {
  readonly resultsByRequest: ReadonlyMap<number, ReadonlyMap<string, TranscriptEntry>>;
  readonly groupedResultIds: ReadonlySet<number>;
} {
  const pending = new Map<string, number[]>();
  const resultsByRequest = new Map<number, Map<string, TranscriptEntry>>();
  const groupedResultIds = new Set<number>();

  for (const entry of entries) {
    for (const call of entry.toolCalls ?? []) {
      const requests = pending.get(call.callId) ?? [];
      requests.push(entry.id);
      pending.set(call.callId, requests);
    }
    if (entry.toolResult === undefined) continue;

    const requests = pending.get(entry.toolResult.callId);
    const requestId = requests?.shift();
    if (requestId === undefined) continue;
    const results = resultsByRequest.get(requestId) ?? new Map<string, TranscriptEntry>();
    results.set(entry.toolResult.callId, entry);
    resultsByRequest.set(requestId, results);
    groupedResultIds.add(entry.id);
    if (requests?.length === 0) pending.delete(entry.toolResult.callId);
  }

  return { resultsByRequest, groupedResultIds };
}

interface ToolExecutionProps {
  readonly call: TranscriptToolCall;
  readonly progress?: ToolProgress;
  readonly result?: TranscriptEntry;
  readonly runActive: boolean;
  readonly showArguments?: boolean;
}

type ToolDisplayStatus = "waiting" | "running" | "completed" | "failed" | "missing";

function ToolExecution({
  call,
  progress,
  result,
  runActive,
  showArguments = true,
}: ToolExecutionProps) {
  const committed = result?.toolResult;
  const status: ToolDisplayStatus =
    committed !== undefined
      ? committed.isError
        ? "failed"
        : "completed"
      : progress?.status === "running"
        ? "running"
        : progress?.status === "done"
          ? "completed"
          : runActive
            ? "waiting"
            : "missing";
  const output = result?.text ?? progress?.output;
  const details = committed?.details ?? progress?.details;
  const diagnostics = result?.diagnostics ?? progress?.diagnostics;
  const timestamp = result?.timestamp === undefined ? undefined : new Date(result.timestamp);
  const summary = status === "completed" ? compactResult(call, output, details) : undefined;

  if (summary !== undefined) {
    return (
      <article className="tool-execution tool-execution--compact">
        {summary.passages === undefined ? (
          <p className="tool-line">{summary.line}</p>
        ) : (
          <details>
            <summary className="tool-line">{summary.line}</summary>
            <MessageText text={summary.passages} />
          </details>
        )}
      </article>
    );
  }

  return (
    <article
      className={`tool-execution tool-execution--${status}`}
      aria-busy={status === "waiting" || status === "running"}
    >
      <header>
        <strong>{call.name}</strong>
        <span className="tool-status">{toolStatusLabel[status]}</span>
        {timestamp === undefined ? null : <MessageTime timestamp={timestamp} />}
      </header>
      {showArguments ? (
        <details>
          <summary>Arguments</summary>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
        </details>
      ) : null}
      {output === undefined || output.length === 0 ? null : <MessageText text={output} />}
      {details === undefined ? null : (
        <details>
          <summary>Details</summary>
          <pre>{JSON.stringify(details, null, 2)}</pre>
        </details>
      )}
      {committed?.nestedCalls === undefined ? null : (
        <details>
          <summary>Nested tool calls</summary>
          <pre>{JSON.stringify(committed.nestedCalls, null, 2)}</pre>
        </details>
      )}
      {diagnostics === undefined || diagnostics.length === 0 ? null : (
        <Diagnostics diagnostics={diagnostics} />
      )}
    </article>
  );
}

/**
 * The claim tools' results as one line each: a lookup names the passages it cited (expandable to their text), a
 * handoff names who has the case. Other tools keep the full view.
 */
function compactResult(
  call: TranscriptToolCall,
  output: string | undefined,
  details: unknown,
): { readonly line: string; readonly passages?: string } | undefined {
  const fields =
    typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
  const field = (name: string): string => {
    const value = fields[name] ?? call.args[name];
    return typeof value === "string" ? value : "";
  };
  switch (call.name) {
    case "lookup": {
      const ids = Array.isArray(fields.ids)
        ? fields.ids.filter((id): id is string => typeof id === "string")
        : passageIds(output ?? "");
      return ids.length === 0
        ? { line: "No passage matched" }
        : { line: `Cited: ${ids.join(", ")}`, passages: output ?? "" };
    }
    case "consult":
      return { line: handoffFor("consult", field("expert")).sentence };
    case "request_approval":
      return { line: handoffFor("request_approval", field("recommendation")).sentence };
    default:
      return undefined;
  }
}

const toolStatusLabel: Record<ToolDisplayStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  missing: "No result",
};

const roleLabel: Record<TranscriptEntry["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
  scheduled: "Scheduled",
  compaction: "Context summary",
  reset: "Context reset",
  event: "Event",
};

function ToolRequest({
  entry,
  onFork,
}: {
  readonly entry: TranscriptEntry;
  readonly onFork?: () => void;
}) {
  const timestamp = entry.timestamp === undefined ? undefined : new Date(entry.timestamp);

  return (
    <article className="transcript-message transcript-message--assistant transcript-message--tool-request">
      <header>
        <EntryTitle
          entryId={entry.id}
          label="Assistant"
          detail="Tool request"
          timestamp={timestamp}
        />
        {onFork === undefined ? null : <ForkAction onFork={onFork} />}
      </header>
    </article>
  );
}

export function TranscriptMessage({
  entry,
  onFork,
}: {
  readonly entry: TranscriptEntry;
  readonly onFork?: () => void;
}) {
  const timestamp = entry.timestamp === undefined ? undefined : new Date(entry.timestamp);
  const human = entry.role === "user" ? humanMessageOf(entry.text) : undefined;
  if (human !== undefined) return <HumanDecisionMessage message={human} timestamp={timestamp} />;
  const { label, text } = speakerOf(entry);

  return (
    <article className={`transcript-message transcript-message--${entry.role}`}>
      <header>
        <EntryTitle entryId={entry.id} label={label} timestamp={timestamp} />
        {!entry.canFork || onFork === undefined ? null : <ForkAction onFork={onFork} />}
      </header>
      {entry.role === "assistant" ? (
        <Markdown text={text} />
      ) : entry.role === "user" && text.includes("\n\nAttachment: ") ? (
        <ClaimMessage {...parseClaimText(text)} />
      ) : (
        <MessageText text={text} />
      )}
      {entry.diagnostics === undefined ? null : <Diagnostics diagnostics={entry.diagnostics} />}
    </article>
  );
}

function EntryTitle({
  entryId,
  label,
  detail,
  timestamp,
}: {
  readonly entryId: number;
  readonly label: string;
  readonly detail?: string;
  readonly timestamp?: Date;
}) {
  return (
    <div className="transcript-message-title" title={`Entry (id: ${entryId})`}>
      <strong>{label}</strong>
      {detail === undefined ? null : <span>{detail}</span>}
      {timestamp === undefined ? null : <MessageTime timestamp={timestamp} />}
    </div>
  );
}

function ForkAction({ onFork }: { readonly onFork: () => void }) {
  return (
    <button
      className="text-button transcript-fork"
      type="button"
      aria-label="Fork from this entry"
      onClick={onFork}
    >
      Fork
    </button>
  );
}

function MessageTime({ timestamp }: { readonly timestamp: Date }) {
  return (
    <time dateTime={timestamp.toISOString()} title={formatAbsoluteTime(timestamp)}>
      {formatMessageTime(timestamp)}
    </time>
  );
}

export function Diagnostics({ diagnostics }: { readonly diagnostics: readonly ToolDiagnostic[] }) {
  return (
    <ul className="diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code ?? "diagnostic"}-${index}`}>
          <strong>{capitalize(diagnostic.severity)}</strong>: {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}

export function MessageText({ text }: { readonly text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </>
  );
}

const formatMessageTime = (timestamp: Date): string => {
  const now = new Date();
  const isToday =
    timestamp.getDate() === now.getDate() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getFullYear() === now.getFullYear();
  return timestamp.toLocaleString(undefined, {
    ...(isToday ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatAbsoluteTime = (timestamp: Date): string =>
  timestamp.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);

/** A person's decision on a handoff, as the server passed it back into the conversation. */
function HumanDecisionMessage({
  message,
  timestamp,
}: {
  readonly message: HumanMessage;
  readonly timestamp: Date | undefined;
}) {
  const { label, tone } = DECISIONS[message.decision];
  return (
    <article
      className="transcript-message transcript-message--human"
      data-handoff={message.handoffId}
    >
      <header>
        <div className="transcript-message-title">
          <strong>{message.reviewer}</strong>
          <span>Decision on handoff #{message.handoffId}</span>
          {timestamp === undefined ? null : (
            <time dateTime={timestamp.toISOString()}>
              {timestamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </time>
          )}
        </div>
      </header>
      <p className="human-decision">
        <span className={`state state--${tone}`}>
          <strong>{label}</strong>
        </span>
        {message.note === "" ? null : <span className="human-decision-note">{message.note}</span>}
      </p>
      <p className="human-decision-trail">
        In the audit trail. Sent to the assistant through BRANE.
      </p>
    </article>
  );
}
