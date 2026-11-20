import {
  type KeyboardEvent,
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MAX_PROMPT_CHARACTERS, ROOT_CONVERSATION_ID } from "../protocol.ts";
import type { ConversationSnapshot } from "./session-state.ts";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { DecisionLog } from "./DecisionLog.tsx";
import { refusalOf } from "./decision-log.ts";
import { RefusalCard } from "./RefusalCard.tsx";
import { ReviewQueue } from "./ReviewQueue.tsx";
import { takeDraft } from "./samples.ts";
import { MessageText, TranscriptList } from "./Transcript.tsx";
import { useDecisionLog } from "./useDecisionLog.ts";
import { usePiSession } from "./usePiSession.ts";

interface ChatSessionProps {
  readonly sessionId: string;
  readonly username: string;
}

const statusLabel = {
  connecting: "Connecting",
  connected: "Connected",
  failed: "Connection failed",
} as const;

const statusTone = { connecting: "waiting", connected: "passed", failed: "blocked" } as const;

const TYPING_IDLE_MS = 1_500;

const typingLabel = (usernames: readonly string[]): string => {
  if (usernames.length === 1) return `${usernames[0]} is typing…`;
  if (usernames.length === 2) return `${usernames[0]}, ${usernames[1]} are typing…`;
  return usernames.length > 2 ? "Many are typing…" : "";
};

const conversationIdFromLocation = (): number | undefined => {
  const value = new URLSearchParams(window.location.search).get("conversation");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

export function ChatSession({ sessionId, username }: ChatSessionProps) {
  const [initialConversationId] = useState(conversationIdFromLocation);
  const session = usePiSession(sessionId, username, initialConversationId);
  const [draft, setDraft] = useState(() => takeDraft(sessionId));
  const [submitting, setSubmitting] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const activityToggleRef = useRef<HTMLButtonElement | null>(null);
  const activityCloseRef = useRef<HTMLButtonElement | null>(null);
  const conversationHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const pinToLatestRef = useRef(true);
  const renderedConversationRef = useRef<number | undefined>(undefined);
  const transcriptHeightRef = useRef(0);
  const autoScrollingRef = useRef(false);
  const autoScrollFrameRef = useRef<number | undefined>(undefined);
  const autoScrollStartRef = useRef(0);
  const autoScrollTargetRef = useRef(0);
  const autoScrollStartedAtRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingConversationRef = useRef<number | undefined>(undefined);
  const activeConversationId = session.activeConversationId;
  const activeConversation = session.activeConversation;
  const activityCount = Object.keys(session.activity?.tasks ?? {}).length;
  const isConnected = session.status === "connected";
  const canSubmit =
    isConnected && activeConversationId !== undefined && !submitting && draft.trim().length > 0;
  const running = activeConversation?.live?.active === true || submitting;
  const decisionLog = useDecisionLog(sessionId, running);
  const failure = activeConversation?.failure;
  const refusal = failure === undefined ? undefined : refusalOf(failure.message, decisionLog.rows);
  // The refused assistant entry in the transcript already shows the card for the latest failure.
  const refusalShown = activeConversation?.entries.at(-1)?.text.includes("422: {") === true;

  const stopTyping = (): void => {
    if (typingTimeoutRef.current !== undefined) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = undefined;
    const conversationId = typingConversationRef.current;
    typingConversationRef.current = undefined;
    if (conversationId !== undefined) session.setTyping(conversationId, false);
  };

  const updateDraft = (content: string): void => {
    setDraft(content);
    if (!isConnected || activeConversationId === undefined || content.length === 0) {
      stopTyping();
      return;
    }
    if (typingConversationRef.current !== activeConversationId) {
      stopTyping();
      typingConversationRef.current = activeConversationId;
      session.setTyping(activeConversationId, true);
    }
    if (typingTimeoutRef.current !== undefined) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const stopAutoScroll = (): void => {
    if (autoScrollFrameRef.current !== undefined) cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = undefined;
    autoScrollingRef.current = false;
  };

  const followLatest = (transcript: HTMLElement): void => {
    const target = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
    if (Math.abs(target - transcript.scrollTop) <= 1) {
      transcript.scrollTop = target;
      stopAutoScroll();
      return;
    }
    autoScrollStartRef.current = transcript.scrollTop;
    autoScrollTargetRef.current = target;
    autoScrollStartedAtRef.current = performance.now();
    if (autoScrollFrameRef.current !== undefined) return;
    autoScrollingRef.current = true;
    const step = (time: number): void => {
      const elapsed = time - autoScrollStartedAtRef.current;
      const progress = Math.min(elapsed / 180, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const start = autoScrollStartRef.current;
      const target = autoScrollTargetRef.current;
      transcript.scrollTop = start + (target - start) * eased;
      if (progress >= 1 || Math.abs(target - transcript.scrollTop) <= 1) {
        transcript.scrollTop = target;
        autoScrollFrameRef.current = undefined;
        autoScrollingRef.current = false;
        return;
      }
      autoScrollFrameRef.current = requestAnimationFrame(step);
    };
    autoScrollFrameRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => stopTyping(), [activeConversationId, isConnected]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript === null) return;

    const conversationChanged = renderedConversationRef.current !== activeConversationId;
    const previousHeight = transcriptHeightRef.current;
    transcriptHeightRef.current = transcript.scrollHeight;
    if (conversationChanged) {
      renderedConversationRef.current = activeConversationId;
      pinToLatestRef.current = true;
      stopAutoScroll();
      transcript.scrollTop = transcript.scrollHeight;
      return;
    }
    if (!pinToLatestRef.current || transcript.scrollHeight === previousHeight) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stopAutoScroll();
      transcript.scrollTop = transcript.scrollHeight;
      return;
    }

    followLatest(transcript);
  });

  useEffect(() => () => stopAutoScroll(), []);

  const openLinkedConversation = useEffectEvent(() => {
    const conversationId = conversationIdFromLocation() ?? ROOT_CONVERSATION_ID;
    if (
      conversationId !== activeConversationId &&
      session.conversations.some(({ id }) => id === conversationId)
    ) {
      session.openConversation(conversationId);
    }
  });

  useEffect(() => {
    const handlePopState = (): void => openLinkedConversation();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const content = draft.trim();
    if (content.length === 0 || activeConversationId === undefined || !isConnected || submitting) {
      return;
    }
    stopTyping();
    setSubmitting(true);
    try {
      const accepted = await session.submitPrompt(activeConversationId, content);
      if (accepted) setDraft((current) => (current === draft ? "" : current));
    } finally {
      setSubmitting(false);
    }
  };

  const trackTranscriptPosition = (): void => {
    const transcript = transcriptRef.current;
    if (transcript === null || autoScrollingRef.current) return;
    const distanceFromLatest =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    pinToLatestRef.current = distanceFromLatest <= 48;
  };

  const interruptAutoScroll = (): void => {
    if (autoScrollingRef.current) stopAutoScroll();
  };

  const submitWithKeyboardShortcut = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const toggleActivity = (): void => {
    const opening = !activityOpen;
    setActivityOpen(opening);
    if (opening) requestAnimationFrame(() => activityCloseRef.current?.focus());
  };

  const closeActivity = (): void => {
    setActivityOpen(false);
    requestAnimationFrame(() => activityToggleRef.current?.focus());
  };

  return (
    <div className={`session-workspace${activityOpen ? " session-workspace--activity-open" : ""}`}>
      <header className="session-bar">
        <a className="product-link" href="/">
          Claims assistant
        </a>
        <p className="session-bar-note">Every model request passes BRANE first.</p>
        <p className="connection-status" role="status">
          <span className={`state state--${statusTone[session.status]}`}>
            {statusLabel[session.status]}
          </span>
        </p>
        <button
          ref={activityToggleRef}
          className="button-secondary activity-toggle"
          type="button"
          aria-controls="activity-panel"
          aria-expanded={activityOpen}
          onClick={toggleActivity}
        >
          Activity <span aria-hidden="true">{activityCount}</span>
        </button>
      </header>

      <main className="conversation-view" aria-labelledby="transcript-heading">
        <h1
          ref={conversationHeadingRef}
          id="transcript-heading"
          className="visually-hidden"
          tabIndex={-1}
        >
          Claim conversation
        </h1>
        {session.error === undefined ? null : (
          <p className="session-error" role="alert">
            {session.error}
          </p>
        )}

        <section
          ref={transcriptRef}
          className="transcript"
          aria-labelledby="transcript-heading"
          role="log"
          tabIndex={0}
          onScroll={trackTranscriptPosition}
          onWheel={interruptAutoScroll}
          onTouchStart={interruptAutoScroll}
          onPointerDown={interruptAutoScroll}
        >
          {activeConversation === undefined ? (
            <p className="transcript-empty">Loading the conversation…</p>
          ) : activeConversation.entries.length === 0 && activeConversation.live === null ? (
            <p className="transcript-empty">
              Paste a claim or ask about one. Send it, then watch the decision log on the right.
            </p>
          ) : (
            <>
              {activeConversation.earlier ? (
                <button
                  className="text-button transcript-load"
                  type="button"
                  onClick={() => session.loadEarlier(activeConversation.id)}
                >
                  Load earlier messages
                </button>
              ) : null}
              <TranscriptList
                entries={activeConversation.entries}
                gaps={activeConversation.gaps}
                tools={activeConversation.tools}
                runActive={activeConversation.live !== null}
                auditRows={decisionLog.rows}
                onFillGap={(gap) => session.fillGap(activeConversation.id, gap)}
              />
            </>
          )}

          {activeConversation?.live === null || activeConversation?.live === undefined ? null : (
            <article
              className="transcript-message transcript-message--assistant transcript-message--live"
              aria-busy={activeConversation.live.active}
            >
              <header>
                <div className="transcript-message-title">
                  <strong>Assistant</strong>
                </div>
              </header>
              {activeConversation.live.text.length === 0 ? (
                <p className="responding">Waiting for BRANE and the model…</p>
              ) : (
                <MessageText text={activeConversation.live.text} />
              )}
              {activeConversation.live.retry === undefined ? null : (
                <p role="status">Retrying: {activeConversation.live.retry.error}</p>
              )}
            </article>
          )}

          {activeConversation === undefined ||
          activeConversation.compactions.length === 0 ? null : (
            <p className="compaction-status" role="status">
              {compactionStatusText(activeConversation.compactions)}
            </p>
          )}

          {failure === undefined ? null : refusal !== undefined ? (
            refusalShown ? null : (
              <RefusalCard refusal={refusal} />
            )
          ) : (
            <p className="transcript-error" role="alert">
              {failure.kind} failed: {failure.message}
            </p>
          )}

          {activeConversation === undefined || activeConversation.queued.length === 0 ? null : (
            <ol className="transcript-list queued-inputs" aria-label="Queued messages">
              {activeConversation.queued.map((input) => (
                <li key={input.submissionId}>
                  <article className="transcript-message transcript-message--user transcript-message--queued">
                    <header>
                      <div className="transcript-message-title">
                        <strong>You</strong>
                        <span>Queued</span>
                      </div>
                    </header>
                    <MessageText text={input.text} />
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>

        <ReviewQueue rows={decisionLog.rows} />

        <form className="prompt-bar" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="prompt">
            Claim or question
          </label>
          <textarea
            id="prompt"
            name="prompt"
            rows={3}
            maxLength={MAX_PROMPT_CHARACTERS}
            value={draft}
            placeholder="Paste a claim or ask about one…"
            onChange={(event) => updateDraft(event.currentTarget.value)}
            onKeyDown={submitWithKeyboardShortcut}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={!isConnected || activeConversationId === undefined}
          />
          <button className="button-primary" type="submit" disabled={!canSubmit}>
            {submitting ? "Sending…" : "Send"}
          </button>
          <p className="typing-indicator" aria-live="polite">
            {typingLabel(activeConversation?.typing ?? [])}
          </p>
        </form>
      </main>

      <DecisionLog
        sessionId={sessionId}
        rows={decisionLog.rows}
        loaded={decisionLog.loaded}
        {...(decisionLog.error === undefined ? {} : { error: decisionLog.error })}
      />

      <ActivityPanel
        graph={session.activity}
        activeConversationId={activeConversationId}
        onClose={closeActivity}
        closeButtonRef={activityCloseRef}
        onOpenConversation={(conversationId) => {
          if (conversationId !== session.activeConversationId) {
            window.history.pushState(null, "", `?conversation=${conversationId}`);
            session.openConversation(conversationId);
          }
          setActivityOpen(false);
          requestAnimationFrame(() => conversationHeadingRef.current?.focus());
        }}
      />
    </div>
  );
}

function compactionStatusText(compactions: ConversationSnapshot["compactions"]): string {
  return compactions.some(({ blocking }) => blocking)
    ? "Compacting context before responding…"
    : "Compacting context in the background…";
}
