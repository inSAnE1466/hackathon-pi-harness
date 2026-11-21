import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ROOT_CONVERSATION_ID } from "../protocol.ts";
import type { ConversationSnapshot } from "./session-state.ts";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { DecisionCard } from "./DecisionCard.tsx";
import { HarnessPanel } from "./HarnessPanel.tsx";
import { Markdown } from "./Markdown.tsx";
import { type ClaimDocument, claimText, type QueueClaim, TYPE_LABEL } from "./queue.ts";
import { RunThread } from "./RunThread.tsx";
import { humanMessageOf, refusalOf } from "./decision-log.ts";
import { Composer } from "./Composer.tsx";
import { RefusalCard } from "./RefusalCard.tsx";
import { MessageText, TranscriptList } from "./Transcript.tsx";
import { useDecisionLog } from "./useDecisionLog.ts";
import { usePiSession } from "./usePiSession.ts";

interface ClaimSessionProps {
  readonly claim: QueueClaim;
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

/** One claim's session: the chat in the centre and "How the harness decided" on the right. */
export function ClaimSession({ claim, sessionId, username }: ClaimSessionProps) {
  const [initialConversationId] = useState(conversationIdFromLocation);
  const session = usePiSession(sessionId, username, initialConversationId);
  // Opening a claim puts its request and attachments in the composer; the person edits and sends it.
  const [draft, setDraft] = useState(claim.request);
  const [attachments, setAttachments] = useState<readonly ClaimDocument[]>(claim.documents);
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
  const running = activeConversation?.live?.active === true || submitting;
  const decisionLog = useDecisionLog(sessionId, running);
  const failure = activeConversation?.failure;
  const refusal = failure === undefined ? undefined : refusalOf(failure.message, decisionLog.rows);
  // The refused assistant entry in the transcript already shows the card for the latest failure.
  const refusalShown = activeConversation?.entries.at(-1)?.text.includes("422: {") === true;
  const started = (activeConversation?.entries.length ?? 0) > 0 || activeConversation?.live != null;
  const handoffs = decisionLog.rows.filter((row) => row.kind === "handoff").toReversed();
  // A decided handoff is shown by its decision message in the chat; its card stays only if that message is missing.
  const answeredInChat = new Set(
    (activeConversation?.entries ?? []).flatMap((entry) => {
      const human = entry.role === "user" ? humanMessageOf(entry.text) : undefined;
      return human === undefined ? [] : [human.handoffId];
    }),
  );
  const approvalReasons = activeConversation?.entries
    .flatMap((entry) => entry.toolCalls ?? [])
    .findLast((call) => call.name === "request_approval")?.args.reasons;

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

  // A claim already sent opens with an empty composer instead of its first message again.
  const prefillSettled = useRef(false);
  useEffect(() => {
    if (prefillSettled.current || activeConversation === undefined) return;
    prefillSettled.current = true;
    if (started) {
      setDraft((current) => (current === claim.request ? "" : current));
      setAttachments((current) => (current === claim.documents ? [] : current));
    }
  }, [activeConversation, started, claim]);

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

  const send = async (content: string): Promise<boolean> => {
    if (content.length === 0 || activeConversationId === undefined || !isConnected || submitting) {
      return false;
    }
    stopTyping();
    setSubmitting(true);
    try {
      return await session.submitPrompt(activeConversationId, content);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (): Promise<void> => {
    const sent = draft;
    const sentAttachments = attachments;
    const text = claimText({ request: sent.trim(), documents: sentAttachments });
    if (await send(text)) {
      setDraft((current) => (current === sent ? "" : current));
      setAttachments((current) => (current === sentAttachments ? [] : current));
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

  const toggleActivity = (): void => {
    const opening = !activityOpen;
    setActivityOpen(opening);
    if (opening) requestAnimationFrame(() => activityCloseRef.current?.focus());
  };

  const closeActivity = (): void => {
    setActivityOpen(false);
    requestAnimationFrame(() => activityToggleRef.current?.focus());
  };

  const runThread = (
    <RunThread rows={decisionLog.rows} tools={activeConversation?.tools ?? []} running={running} />
  );

  return (
    <>
      <main
        className={`chat${activityOpen ? " chat--activity-open" : ""}`}
        aria-labelledby="claim-heading"
      >
        <header className="chat-header">
          <div className="chat-title">
            <h2 ref={conversationHeadingRef} id="claim-heading" tabIndex={-1}>
              {claim.title}
            </h2>
            <p>
              {TYPE_LABEL[claim.type]} · {claim.claimant}
            </p>
          </div>
          <p className="connection-status" role="status">
            <span className={`state state--${statusTone[session.status]}`}>
              {statusLabel[session.status]}
            </span>
          </p>
          <button
            ref={activityToggleRef}
            className="button-secondary"
            type="button"
            aria-controls="activity-panel"
            aria-expanded={activityOpen}
            onClick={toggleActivity}
          >
            Activity <span className="count">{activityCount}</span>
          </button>
        </header>

        {session.error === undefined ? null : (
          <p className="inline-error" role="alert">
            {session.error}
          </p>
        )}

        <section
          ref={transcriptRef}
          className="transcript"
          aria-label="Conversation"
          role="log"
          tabIndex={0}
          onScroll={trackTranscriptPosition}
          onWheel={interruptAutoScroll}
          onTouchStart={interruptAutoScroll}
          onPointerDown={interruptAutoScroll}
        >
          {activeConversation === undefined ? (
            <div className="skeleton" aria-busy="true" aria-label="Loading the conversation">
              <span />
              <span />
              <span />
            </div>
          ) : !started ? (
            submitting ? (
              <div className="transcript-list">{runThread}</div>
            ) : (
              <div className="transcript-empty">
                <p className="transcript-empty-title">Nothing sent yet</p>
                <p className="quiet">
                  {claim.claimant}'s claim is in the message box. Edit it, then send. BRANE checks
                  every model request, and you decide.
                </p>
              </div>
            )
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
                afterFirstPrompt={runThread}
              />
              {activeConversation.entries.some((entry) => entry.role === "user") ? null : runThread}
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
                <Markdown text={activeConversation.live.text} />
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

          {running
            ? null
            : handoffs
                .filter((handoff) => !answeredInChat.has(handoff.id))
                .map((handoff) => (
                  <DecisionCard
                    key={handoff.id}
                    sessionId={sessionId}
                    handoff={handoff}
                    rows={decisionLog.rows}
                    onRecorded={decisionLog.reload}
                    {...(typeof approvalReasons === "string" ? { reasons: approvalReasons } : {})}
                  />
                ))}
        </section>

        <Composer
          draft={draft}
          attachments={attachments}
          placeholder={started ? "Ask a follow-up about this claim" : "Write the claim"}
          disabled={!isConnected || activeConversationId === undefined}
          submitting={submitting}
          typing={typingLabel(activeConversation?.typing ?? [])}
          onDraft={updateDraft}
          onRemoveAttachment={(name) =>
            setAttachments((current) => current.filter((document) => document.name !== name))
          }
          onSubmit={() => void submit()}
        />
      </main>

      <HarnessPanel
        sessionId={sessionId}
        rows={decisionLog.rows}
        loaded={decisionLog.loaded}
        running={running}
        {...(decisionLog.chain === undefined ? {} : { chain: decisionLog.chain })}
        {...(decisionLog.error === undefined ? {} : { error: decisionLog.error })}
      />

      <ActivityPanel
        graph={session.activity}
        activeConversationId={activeConversationId}
        onClose={closeActivity}
        closeButtonRef={activityCloseRef}
        onOpenConversation={(conversationId) => {
          if (conversationId !== session.activeConversationId) {
            window.history.pushState(null, "", conversationHref(conversationId));
            session.openConversation(conversationId);
          }
          setActivityOpen(false);
          requestAnimationFrame(() => conversationHeadingRef.current?.focus());
        }}
      />
    </>
  );
}

/** The current URL with `conversation` set, keeping the selected claim. */
function conversationHref(conversationId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("conversation", String(conversationId));
  return `?${params.toString()}`;
}

function compactionStatusText(compactions: ConversationSnapshot["compactions"]): string {
  return compactions.some(({ blocking }) => blocking)
    ? "Compacting context before responding…"
    : "Compacting context in the background…";
}
