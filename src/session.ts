import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type Conversation,
  type ConversationId,
  type ConversationRecord,
  type ConversationView,
  type Cursor,
  defineDocFamily,
  type EntryId,
  Harness,
  type TaskGraph,
  type Wake,
  type WatchHandle,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { normalizeUsername } from "./identity.ts";
import { createChatHarnessOptions } from "./chat.ts";
import { AuditLog, handoffTool, type AuditRow } from "./audit.ts";
import { intake, type IntakeResult } from "./primitives/intake.ts";
import {
  InvalidClientCommand,
  MAX_CLIENT_FRAME_CHARACTERS,
  parseClientCommand,
  type ClientCommand,
  type ConversationSummary,
  type ServerEvent,
} from "./protocol.ts";
import { KeyedSerialQueue } from "./serial.ts";
import { SwitchStore, switchesForAudit } from "./switches.ts";

const json = (body: unknown, status: number, headers?: HeadersInit): Response =>
  Response.json(body, { status, headers });

const reportError = (
  message: string,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): void => {
  console.error(
    JSON.stringify({
      message,
      ...details,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};

/** While work can run, the alarm stays this far ahead, so an evicted instance is woken to resume it. */
const HEARTBEAT_MS = 60_000;
const CONVERSATION_PAGE_SIZE = 100;

type ConversationCommandReceipt =
  | {
      command: "conversation.create";
      conversationId: ConversationId;
    }
  | {
      command: "conversation.fork";
      conversationId: ConversationId;
      parentConversationId: ConversationId;
      entryId: EntryId;
    };

const ConversationCommandReceipts = defineDocFamily<
  {
    receipt?: ConversationCommandReceipt;
  },
  null
>({
  family: true,
  kind: "app.conversation-command-receipt",
  version: 1,
  scope: "session",
  initial: () => ({}),
  // Written once per request ID, so there is no delta history to bound.
  checkpointWhen: () => false,
});

type SessionConnectionState = {
  readonly username: string;
  readonly conversationId?: number;
  readonly typing?: true;
};

type LegacyPartyServerAttachment = {
  readonly __user?: unknown;
};

type WSMessage = string | ArrayBuffer;

const isSessionConnectionState = (value: unknown): value is SessionConnectionState => {
  if (typeof value !== "object" || value === null || !("username" in value)) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.username === "string" &&
    (state.conversationId === undefined ||
      (typeof state.conversationId === "number" &&
        Number.isSafeInteger(state.conversationId) &&
        state.conversationId > 0)) &&
    (state.typing === undefined || state.typing === true)
  );
};

const connectionState = (socket: WebSocket): SessionConnectionState | null => {
  const attachment: unknown = socket.deserializeAttachment();
  // Hibernated sockets can survive a deployment from the former PartyServer implementation.
  if (isSessionConnectionState(attachment)) return attachment;
  if (typeof attachment !== "object" || attachment === null || !("__user" in attachment)) {
    return null;
  }
  const legacy = attachment as LegacyPartyServerAttachment;
  return isSessionConnectionState(legacy.__user) ? legacy.__user : null;
};

const setConnectionState = (socket: WebSocket, state: SessionConnectionState): void => {
  socket.serializeAttachment(state);
};

const usernameForConnection = (connectionId: string, request: Request): string => {
  const requested = new URL(request.url).searchParams.get("username") ?? "";
  const username = normalizeUsername(requested);
  if (username.length > 0) return username;
  const suffix = connectionId.replace(/[^a-z0-9]/giu, "").slice(0, 6) || "guest";
  return `Guest-${suffix}`;
};

const isReservedCloseCode = (code: number): boolean =>
  code === 1005 || code === 1006 || code === 1015;

const reciprocateClose = (socket: WebSocket, code: number, reason: string): void => {
  if (isReservedCloseCode(code)) return;
  try {
    socket.close(code, reason);
  } catch {
    // The socket is already closed or the peer is no longer reachable.
  }
};

const attributedPrompt = (username: string, content: string): string => `[${username}]\n${content}`;

/** A person's decision as the agent reads it. The first two lines are a fixed shape the client renders as a decision. */
const decisionMessage = (handoff: AuditRow, decision: AuditRow): string => {
  const tool = handoffTool(handoff);
  const next =
    tool === "consult"
      ? "This is the expert's answer to your consult. Continue preparing the claim with it."
      : "This is the claims handler's decision on your recommendation. Acknowledge it in one or two sentences and list what the handler still has to do. Do not change the decision.";
  return [
    `Human decision on handoff #${handoff.id} (${tool}): ${decision.action}`,
    ...(decision.detail === "" ? [] : [`Note: ${decision.detail}`]),
    "",
    next,
  ].join("\n");
};

const conversationSummary = (conversation: ConversationRecord): ConversationSummary => ({
  id: conversation.id,
  ...(conversation.parent === undefined
    ? {}
    : {
        parent: {
          conversationId: conversation.parent.conversationId,
          at: conversation.parent.at,
        },
      }),
  ...(conversation.owner === undefined
    ? {}
    : { owner: { conversationId: conversation.owner.conversationId } }),
});

export class Session extends DurableObject<Env> {
  #harness!: Harness;
  #activity!: WatchHandle<TaskGraph>;
  readonly #views = new Map<WebSocket, WatchHandle<ConversationView>>();
  readonly #typingConnections = new Set<WebSocket>();
  readonly #connectionOperations = new KeyedSerialQueue<WebSocket>();
  #alarmWrites: Promise<void> = Promise.resolve();
  readonly #audit: AuditLog;
  readonly #switches: SwitchStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#audit = new AuditLog(ctx.storage.sql);
    this.#switches = new SwitchStore(ctx.storage.sql);
    void ctx.blockConcurrencyWhile(() => this.#initialize());
  }

  async #initialize(): Promise<void> {
    // A fallback before anything can throw: an object whose open or recovery fails is started again.
    const fallback = Date.now() + HEARTBEAT_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > fallback) await this.ctx.storage.setAlarm(fallback);

    const storage = await openDurableObjectSqliteStorage(this.ctx.storage);
    const harness = await Harness.open(
      storage,
      {
        ...createChatHarnessOptions(
          (decision) => this.#audit.brane(decision),
          (event) => this.#audit.gate(event),
          () => this.#switches.current,
        ),
        // `kind` says what happened, e.g. `task_faulted` or `task_interrupted`, with the task and extension.
        onReport: ({ error, ...report }) =>
          reportError("Harness reported a failure", error, report),
        // Called after open and whenever the next wake changes. With `onWake`, the Harness keeps no timer for
        // sleeps: the alarm calls `resume()`. A failed alarm write resets the object; it arms again on restart.
        onWake: (wake) => void this.#arm(wake).catch(() => this.ctx.abort("Alarm write failed")),
      },
      BACKGROUND_CONTEXT,
    );

    // A storage error closes the harness. Reset the object so the next event reopens it.
    void harness.closed.then((end) => {
      if (end.kind === "failed") this.ctx.abort("Harness failed");
    });

    let activity: WatchHandle<TaskGraph> | undefined;
    try {
      this.#harness = harness;
      activity = await harness.watchTaskGraph(BACKGROUND_CONTEXT);
      this.#activity = activity;
      activity.start(async (call) => {
        if (call.kind === "value")
          this.#broadcast({ type: "session.activity", activity: call.value });
      });
      // Subagents are created by background tool tasks, not client commands.
      // Notify connected clients when their conversation records are committed.
      harness.observeCommits({
        advance: (publication) => {
          for (const change of publication.changes) {
            if (change.type !== "conversation" || change.value.owner === undefined) continue;
            this.#broadcast({
              type: "conversation.created",
              conversation: conversationSummary(change.value),
            });
          }
        },
        end: () => {},
      });
      await this.#restoreViews();
      // Armed before `resume()` runs anything, as for any call that can start work.
      await this.#arm(harness.wake());
      // Continue work a lost instance left, and make due sleeps runnable.
      harness.resume();
    } catch (error) {
      await activity?.stop();
      await harness.close(BACKGROUND_CONTEXT);
      throw error;
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const audit = /\/audit(?:\/(human|verify))?\/?$/.exec(new URL(request.url).pathname);
    if (audit !== null) return this.#auditRequest(request, audit[1]);
    if (/\/switches\/?$/.test(new URL(request.url).pathname)) return this.#switchesRequest(request);
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426, { Upgrade: "websocket" });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connectionId = new URL(request.url).searchParams.get("_pk") || crypto.randomUUID();

    this.ctx.acceptWebSocket(server);
    setConnectionState(server, { username: usernameForConnection(connectionId, request) });
    try {
      await this.#connect(server);
    } catch (error) {
      reportError("Session WebSocket connection failed", error);
      try {
        server.close(1011, "Session setup failed");
      } catch {
        // The accepted socket may already have closed while setup was running.
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async alarm(): Promise<void> {
    // Armed before `resume()` can start work, as on open.
    await this.#arm({ ...this.#harness.wake(), active: true });
    this.#harness.resume();
    // Alarms are at-least-once, and `onWake` repeats no unchanged wake: an early or spurious alarm would otherwise
    // leave the heartbeat armed with nothing to do. `wake()` already counts the work `resume()` made runnable.
    await this.#arm(this.#harness.wake());
  }

  override async webSocketMessage(socket: WebSocket, message: WSMessage): Promise<void> {
    try {
      await this.#connectionOperations.run(socket, () => this.#processMessage(socket, message));
    } catch (error) {
      reportError("Session WebSocket message failed", error);
    }
  }

  /**
   * The audit API: `GET /audit` (rows and the chain check), `GET /audit?format=csv` (the whole trail),
   * `GET /audit/verify` (the chain check alone) and `POST /audit/human` (a person's decision on a handoff, which
   * is also passed back into the conversation).
   */
  async #auditRequest(request: Request, action: string | undefined): Promise<Response> {
    if (action === "human") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await request.json();
        if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
      } catch {
        return json({ error: "Body must be JSON" }, 400);
      }
      const result = this.#audit.human({
        handoffId: body.handoffId,
        decision: body.decision,
        note: body.note,
        reviewer: body.reviewer,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      return json({ decision: result.row, message: await this.#returnDecision(result.row) }, 201);
    }
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    if (action === "verify") return json({ chain: this.#audit.verify() }, 200);
    if (new URL(request.url).searchParams.get("format") === "csv") {
      return new Response(this.#audit.csv(), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-trail-${this.ctx.id.toString().slice(0, 8)}.csv"`,
        },
      });
    }
    return json(
      {
        decisions: this.#audit.list(),
        chain: this.#audit.verify(),
        switches: this.#switches.current,
      },
      200,
    );
  }

  /** `GET /switches` reads the session's harness switches; `PUT /switches` changes the given ones. */
  async #switchesRequest(request: Request): Promise<Response> {
    if (request.method === "GET") return json({ switches: this.#switches.current }, 200);
    if (request.method !== "PUT")
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, PUT" });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const result = this.#switches.set(body);
    if (!result.ok) return json({ error: result.error }, 400);
    this.#audit.config(switchesForAudit(result.switches));
    return json({ switches: result.switches }, 200);
  }

  /**
   * Passes a recorded decision back into the conversation the handoff came from, as a message the agent continues
   * from. It is an ordinary input: the model request it starts goes through BRANE like every other, and a refusal
   * fails that turn. Returns the `request` row that links the message to the `human` row, or null when the
   * conversation is gone or the handoff is a refusal, which is never sent back to a model. The human row stands either way.
   */
  async #returnDecision(decision: AuditRow): Promise<AuditRow | null> {
    const handoff = this.#audit.get(decision.refId);
    // A refused request stays with the person: BRANE would refuse the same conversation again.
    if (handoff === undefined || handoffTool(handoff) === "refusal") return null;
    const root = await this.#harness.root(BACKGROUND_CONTEXT);
    // Handoffs logged before the conversation was recorded came from the claim's root conversation.
    const conversationId = (handoff.conversationId || root.id) as ConversationId;
    const conversation = await this.#harness.conversation(conversationId, BACKGROUND_CONTEXT);
    if (conversation === undefined) return null;
    await this.#arm({ ...this.#harness.wake(), active: true });
    const message = this.#audit.request(decision.actor, conversationId, decision.id);
    await conversation.submit(
      {
        type: "input",
        content: attributedPrompt(decision.actor, decisionMessage(handoff, decision)),
        // One message per decision, also when the request is retried.
        requestId: `human-decision-${decision.id}`,
        whenBusy: "followUp",
      },
      BACKGROUND_CONTEXT,
    );
    return message;
  }

  async #processMessage(socket: WebSocket, message: WSMessage): Promise<void> {
    if (typeof message !== "string") {
      this.#send(socket, {
        type: "error",
        error: { code: "invalid_message", message: "Binary messages are not supported" },
      });
      socket.close(1002, "Binary protocol frame");
      return;
    }

    if (message.length > MAX_CLIENT_FRAME_CHARACTERS) {
      this.#send(socket, {
        type: "error",
        error: { code: "frame_too_large", message: "Command frame exceeds the size limit" },
      });
      socket.close(1009, "Command frame too large");
      return;
    }

    let command: ClientCommand;
    try {
      command = parseClientCommand(message);
    } catch (error) {
      if (!(error instanceof InvalidClientCommand)) throw error;
      this.#send(socket, {
        type: "error",
        error: { code: "invalid_command", message: error.message },
      });
      socket.close(1002, "Invalid command frame");
      return;
    }

    try {
      await this.#handleCommand(socket, command);
    } catch (error) {
      reportError("Session command failed", error, { command: command.type });
      if (command.type === "presence.typing") return;
      this.#send(socket, {
        type: "command.result",
        command: command.type,
        requestId: command.requestId,
        ok: false,
        error: {
          code: "command_failed",
          message: error instanceof Error ? error.message : "Command failed",
        },
      });
    }
  }

  override async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      await this.#connectionOperations.run(socket, async () => {
        this.#setTyping(socket, false);
        await this.#stopView(socket);
      });
    } catch (error) {
      reportError("Session WebSocket close failed", error);
    } finally {
      reciprocateClose(socket, code, reason);
    }
  }

  override async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    try {
      await this.#connectionOperations.run(socket, async () => {
        reportError("Session WebSocket failed", error);
        this.#setTyping(socket, false);
        await this.#stopView(socket);
      });
    } catch (handlerError) {
      reportError("Session WebSocket error cleanup failed", handlerError);
    }
  }

  async #connect(server: WebSocket): Promise<void> {
    const root = await this.#harness.root(BACKGROUND_CONTEXT);
    await this.#sendSessionSnapshot(server);
    await this.#watchConversation(server, root.id);
  }

  async #handleCommand(socket: WebSocket, command: ClientCommand): Promise<void> {
    switch (command.type) {
      case "presence.typing":
        if (connectionState(socket)?.conversationId === command.conversationId) {
          this.#setTyping(socket, command.typing);
        }
        return;
      case "conversation.open":
        await this.#requireConversation(command.conversationId as ConversationId);
        await this.#watchConversation(socket, command.conversationId as ConversationId);
        this.#send(socket, {
          type: "command.result",
          command: command.type,
          requestId: command.requestId,
          ok: true,
        });
        return;
      case "conversation.entries": {
        const conversation = await this.#requireConversation(
          command.conversationId as ConversationId,
        );
        const page = await conversation.entries(
          {
            ...(command.minEntryId === undefined
              ? {}
              : { minEntryId: command.minEntryId as EntryId }),
            ...(command.maxEntryId === undefined
              ? {}
              : { maxEntryId: command.maxEntryId as EntryId }),
            order: command.order,
          },
          command.limit,
          undefined,
          BACKGROUND_CONTEXT,
        );
        this.#send(socket, {
          type: "command.result",
          command: command.type,
          requestId: command.requestId,
          ok: true,
          conversationId: conversation.id,
          page: { items: page.items, ...(page.next === undefined ? {} : { next: page.next }) },
        });
        return;
      }
      case "conversation.create": {
        const conversationId = await this.#harness.commit(async (tx) => {
          const doc = await tx.doc(ConversationCommandReceipts, command.requestId, null);
          const existing = doc.receipt;
          if (existing !== undefined) {
            if (existing.command !== command.type) {
              throw new Error(
                `Request ${command.requestId} was already used for ${existing.command}`,
              );
            }
            return existing.conversationId;
          }
          const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
          doc.receipt = {
            command: command.type,
            conversationId: conversation.id,
          };
          return conversation.id;
        }, BACKGROUND_CONTEXT);
        await this.#watchConversation(socket, conversationId);
        await this.#broadcastSessionSnapshot();
        this.#send(socket, {
          type: "command.result",
          command: command.type,
          requestId: command.requestId,
          ok: true,
          conversationId,
        });
        return;
      }
      case "conversation.fork": {
        const parentConversationId = command.conversationId as ConversationId;
        const entryId = command.entryId as EntryId;
        const conversationId = await this.#harness.commit(async (tx) => {
          const doc = await tx.doc(ConversationCommandReceipts, command.requestId, null);
          const existing = doc.receipt;
          if (existing !== undefined) {
            if (
              existing.command !== command.type ||
              existing.parentConversationId !== parentConversationId ||
              existing.entryId !== entryId
            ) {
              throw new Error(`Request ${command.requestId} was already used for another command`);
            }
            return existing.conversationId;
          }
          const fork = await tx.forkConversation(parentConversationId, entryId, {
            ownership: { kind: "ownerless" },
          });
          doc.receipt = {
            command: command.type,
            conversationId: fork.id,
            parentConversationId,
            entryId,
          };
          return fork.id;
        }, BACKGROUND_CONTEXT);
        await this.#watchConversation(socket, conversationId);
        await this.#broadcastSessionSnapshot();
        this.#send(socket, {
          type: "command.result",
          command: command.type,
          requestId: command.requestId,
          ok: true,
          conversationId,
        });
        return;
      }
      case "prompt.submit": {
        this.#setTyping(socket, false);
        const conversation = await this.#requireConversation(
          command.conversationId as ConversationId,
        );
        // Arm before admitting work: `onWake` runs after the commit, so an instance that dies in between is
        // still woken. An early alarm is harmless; a missing one strands the turn.
        await this.#arm({ ...this.#harness.wake(), active: true });
        this.#audit.request(connectionState(socket)?.username ?? "Guest", command.conversationId);
        // Intake: when BRANE would keep the whole claim local for health reasons, the local model first reduces the
        // medical part to a health-free fact sheet, so the agent's turns can use the frontier model.
        // Both need BRANE's dry run before the turn, so `braneTiming: inline` skips intake too.
        const switches = this.#switches.current;
        const split: IntakeResult =
          switches.intake === "on" && switches.braneTiming === "preflight"
            ? await intake(this.env, command.content, switches.localModel, (decision) =>
                this.#audit.brane(decision),
              )
            : { kind: "unchanged" };
        this.#audit.gate({
          kind: "intake",
          result:
            split.kind === "failed"
              ? `kept local: ${split.reason}`
              : switches.intake === "off"
                ? "off"
                : switches.braneTiming === "inline"
                  ? "skipped: inline"
                  : split.kind,
        });
        const submission = await conversation.submit(
          {
            type: "input",
            content: attributedPrompt(
              connectionState(socket)?.username ?? "Guest",
              split.kind === "split" ? split.content : command.content,
            ),
            requestId: command.requestId,
            // Queue behind a running turn instead of rejecting; the inbox places it after the current answer.
            whenBusy: "followUp",
          },
          BACKGROUND_CONTEXT,
        );
        this.#send(socket, {
          type: "command.result",
          command: command.type,
          requestId: command.requestId,
          ok: true,
          conversationId: conversation.id,
          submissionId: submission.id,
        });
        return;
      }
    }
  }

  async #requireConversation(id: ConversationId): Promise<Conversation> {
    const conversation = await this.#harness.conversation(id, BACKGROUND_CONTEXT);
    if (conversation === undefined) throw new Error(`Conversation ${id} does not exist`);
    return conversation;
  }

  async #sendSessionSnapshot(socket: WebSocket): Promise<void> {
    this.#send(socket, {
      type: "session.snapshot",
      session: { conversations: await this.#sessionSnapshot(), activity: this.#activity.value },
    });
  }

  async #broadcastSessionSnapshot(): Promise<void> {
    this.#broadcast({
      type: "session.snapshot",
      session: { conversations: await this.#sessionSnapshot(), activity: this.#activity.value },
    });
  }

  #sessionSnapshot(): Promise<readonly ConversationSummary[]> {
    return this.#harness.commit(async (tx) => {
      const conversations: ConversationSummary[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanConversations({}, CONVERSATION_PAGE_SIZE, cursor);
        conversations.push(...page.items.map(conversationSummary));
        cursor = page.next;
      } while (cursor !== undefined);
      return conversations;
    }, BACKGROUND_CONTEXT);
  }

  async #watchConversation(
    socket: WebSocket,
    conversationId: ConversationId,
    restoreTyping = false,
  ): Promise<void> {
    this.#setTyping(socket, false);
    await this.#stopView(socket);
    const username = connectionState(socket)?.username ?? "Guest";
    setConnectionState(socket, { username });
    const conversation = await this.#requireConversation(conversationId);
    // A window over the transcript and the conversation's built-in documents: the run, the streamed answer, tool
    // progress, the queue, the agent, and usage. The client pages older entries with `conversation.entries`.
    const view = await conversation.watch(BACKGROUND_CONTEXT);
    this.#views.set(socket, view);
    setConnectionState(socket, {
      username,
      conversationId,
      ...(restoreTyping ? { typing: true } : {}),
    });
    if (restoreTyping) this.#typingConnections.add(socket);
    this.#send(socket, { type: "conversation.view", conversationId, view: view.value });
    view.start(async (call) => {
      if (this.#views.get(socket) !== view || call.kind !== "value") return;
      this.#send(socket, { type: "conversation.ops", conversationId, ops: call.ops });
    });
    void view.closed.finally(() => {
      if (this.#views.get(socket) === view) this.#views.delete(socket);
    });
    this.#broadcastTyping(conversationId);
  }

  async #stopView(socket: WebSocket): Promise<void> {
    const view = this.#views.get(socket);
    if (view === undefined) return;
    this.#views.delete(socket);
    await view.stop();
  }

  async #restoreViews(): Promise<void> {
    for (const socket of this.#connections()) {
      const attachment = connectionState(socket);
      if (attachment?.conversationId !== undefined) {
        const conversationId = attachment.conversationId as ConversationId;
        await this.#watchConversation(socket, conversationId, attachment.typing === true);
      }
    }
  }

  #connections(): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.READY_STATE_OPEN);
  }

  #broadcast(event: ServerEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.#connections()) this.#sendMessage(socket, message);
  }

  #send(socket: WebSocket, event: ServerEvent): void {
    this.#sendMessage(socket, JSON.stringify(event));
  }

  #sendMessage(socket: WebSocket, message: string): void {
    if (socket.readyState !== WebSocket.READY_STATE_OPEN) return;
    try {
      socket.send(message);
    } catch {
      try {
        socket.close(1011, "Unexpected send error");
      } catch {
        // The socket may already have closed after the ready-state check.
      }
    }
  }

  #setTyping(socket: WebSocket, typing: boolean): void {
    const state = connectionState(socket);
    if (state === null || state.conversationId === undefined) return;
    const conversationId = state.conversationId;
    const changed = typing
      ? !this.#typingConnections.has(socket)
      : this.#typingConnections.delete(socket);
    if (typing) this.#typingConnections.add(socket);
    if (socket.readyState === WebSocket.READY_STATE_OPEN) {
      setConnectionState(socket, {
        username: state.username,
        conversationId,
        ...(typing ? { typing: true } : {}),
      });
    }
    if (changed) this.#broadcastTyping(conversationId as ConversationId);
  }

  #broadcastTyping(conversationId: ConversationId): void {
    const connections = this.#connections().filter(
      (connection) => connectionState(connection)?.conversationId === conversationId,
    );
    const typers = connections.filter((connection) => this.#typingConnections.has(connection));
    for (const receiver of connections) {
      const usernames = [
        ...new Set(
          typers
            .filter((connection) => connection !== receiver)
            .map((connection) => connectionState(connection)?.username)
            .filter((username): username is string => username !== undefined),
        ),
      ].sort((left, right) => left.localeCompare(right));
      this.#send(receiver, { type: "presence.typing", conversationId, usernames });
    }
  }

  /** The one alarm: the earliest sleep, or a recovery heartbeat while work can run, whichever comes first. */
  #arm(wake: Wake): Promise<void> {
    // Serialized, so an older wake cannot overwrite a newer, earlier deadline.
    const write = this.#alarmWrites.then(async () => {
      const heartbeat = wake.active ? Date.now() + HEARTBEAT_MS : undefined;
      // `wake.at` is on the Harness clock, which is the default `Date.now`.
      const at =
        heartbeat === undefined || wake.at === undefined
          ? (heartbeat ?? wake.at)
          : Math.min(heartbeat, wake.at);
      if (at === undefined) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(at);
    });
    this.#alarmWrites = write.catch(() => undefined);
    return write;
  }
}
