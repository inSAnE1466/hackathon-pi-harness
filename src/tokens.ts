import { Tokens } from "./primitives/detect.ts";

/**
 * The pre-mask's tokens, one map per conversation, in the session's own SQLite. The same value gets the same token
 * in every request, tool result and message of that conversation, across restarts. The table holds the real values.
 * It is read by the pre-mask and by the authorised handler's view (`GET /api/sessions/:id/tokens`), and it is never
 * part of a model request.
 */
export class TokenStore {
  readonly #sql: SqlStorage;
  readonly #byConversation = new Map<number, Tokens>();

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS harness_tokens (
      conversation_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      token TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (conversation_id, key)
    )`);
  }

  for(conversationId: number): Tokens {
    let tokens = this.#byConversation.get(conversationId);
    if (tokens === undefined) {
      const stored = this.#sql
        .exec(
          `SELECT key, token, text FROM harness_tokens WHERE conversation_id = ? ORDER BY rowid`,
          conversationId,
        )
        .toArray()
        .map((row) => ({ key: String(row.key), token: String(row.token), text: String(row.text) }));
      tokens = new Tokens(stored, (key, token, text) =>
        this.#sql.exec(
          `INSERT OR IGNORE INTO harness_tokens (conversation_id, key, token, text) VALUES (?, ?, ?, ?)`,
          conversationId,
          key,
          token,
          text,
        ),
      );
      this.#byConversation.set(conversationId, tokens);
    }
    return tokens;
  }

  /** Every token of the session with the value it stands for, for the handler's screen. */
  list(): { readonly conversationId: number; readonly token: string; readonly text: string }[] {
    return this.#sql
      .exec(`SELECT conversation_id, token, text FROM harness_tokens ORDER BY rowid`)
      .toArray()
      .map((row) => ({
        conversationId: Number(row.conversation_id),
        token: String(row.token),
        text: String(row.text),
      }));
  }
}
