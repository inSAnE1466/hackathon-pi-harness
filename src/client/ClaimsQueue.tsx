import { useEffect, useState } from "react";
import { type AuditRow, type ClaimStatus, claimStatus, type Tone } from "./decision-log.ts";
import { type ClaimType, QUEUE, TYPE_LABEL } from "./queue.ts";

const POLL_MS = 4_000;

const STATUS: Record<ClaimStatus, { readonly label: string; readonly tone?: Tone }> = {
  new: { label: "New" },
  "in-progress": { label: "In progress" },
  waiting: { label: "Waiting on expert", tone: "waiting" },
  prepared: { label: "Prepared", tone: "waiting" },
  refused: { label: "Refused", tone: "blocked" },
  approved: { label: "Approved", tone: "passed" },
  edited: { label: "Edited", tone: "passed" },
  rejected: { label: "Rejected", tone: "blocked" },
};

interface ClaimsQueueProps {
  /** Claim id to session id, for the claims opened so far. */
  readonly sessions: Readonly<Record<string, string>>;
  readonly selectedId: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (claimId: string) => void;
}

/** The fixed queue of synthetic claims, each with where it stands. Folds to a strip of type icons. */
export function ClaimsQueue({ sessions, selectedId, open, onToggle, onSelect }: ClaimsQueueProps) {
  const statuses = useStatuses(sessions);

  return (
    <nav className="queue" aria-label="Claims queue">
      <div className="queue-header">
        {open ? (
          <h2>
            Queue <span className="queue-count">{QUEUE.length}</span>
          </h2>
        ) : null}
        <button
          className="icon-button"
          type="button"
          aria-expanded={open}
          aria-controls="queue-list"
          aria-label={open ? "Fold the queue" : "Open the queue"}
          title={open ? "Fold the queue" : "Open the queue"}
          onClick={onToggle}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="2" />
            <path d="M6 2.5v11" />
          </svg>
        </button>
      </div>
      <ul id="queue-list" className="queue-list">
        {QUEUE.map((claim) => {
          const sessionId = sessions[claim.id];
          const status = sessionId === undefined ? "new" : statuses[sessionId];
          const state =
            status === undefined ? { label: "Checking", tone: undefined } : STATUS[status];
          const selected = claim.id === selectedId;
          return (
            <li key={claim.id}>
              <a
                className="queue-row"
                href={`/?claim=${claim.id}`}
                aria-current={selected ? "page" : undefined}
                aria-label={open ? undefined : `${claim.title}, ${state.label}`}
                title={open ? undefined : `${claim.title}: ${state.label}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                    return;
                  event.preventDefault();
                  onSelect(claim.id);
                }}
              >
                <TypeIcon type={claim.type} />
                <span className="queue-row-text">
                  <span className="queue-row-title">{claim.title}</span>
                  <span className="queue-row-meta">
                    {TYPE_LABEL[claim.type]} · {claim.claimant}
                  </span>
                </span>
                <span
                  className={`queue-status${state.tone === undefined ? "" : ` state state--${state.tone}`}`}
                >
                  {state.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Each opened claim's status from its session's decision log, refreshed while the page is open. */
function useStatuses(
  sessions: Readonly<Record<string, string>>,
): Readonly<Record<string, ClaimStatus>> {
  const [statuses, setStatuses] = useState<Readonly<Record<string, ClaimStatus>>>({});
  const ids = Object.values(sessions).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      for (const sessionId of ids === "" ? [] : ids.split(",")) {
        void fetch(`/api/sessions/${sessionId}/audit`)
          .then((response) => (response.ok ? response.json() : undefined))
          .then((body: { readonly decisions?: AuditRow[] } | undefined) => {
            if (cancelled || body === undefined) return;
            const status = claimStatus(body.decisions ?? []);
            setStatuses((current) =>
              current[sessionId] === status ? current : { ...current, [sessionId]: status },
            );
          })
          .catch(() => undefined);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ids]);

  return statuses;
}

const ICON_PATHS: Record<ClaimType, string> = {
  health: "M6.5 2.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z",
  travel: "M3 13.5h10M4 5.5h8a1 1 0 0 1 1 1v5H3v-5a1 1 0 0 1 1-1zM6 5.5v-2h4v2",
  motor: "M2.5 11.5v-3l1.5-3.5h8l1.5 3.5v3zM2.5 8.5h11M5 11.5v1.5M11 11.5v1.5",
  request: "M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h4",
};

function TypeIcon({ type }: { readonly type: ClaimType }) {
  return (
    <span className="queue-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d={ICON_PATHS[type]} />
      </svg>
    </span>
  );
}
