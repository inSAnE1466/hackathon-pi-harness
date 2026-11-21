import { type KeyboardEvent, useLayoutEffect, useRef } from "react";
import { MAX_PROMPT_CHARACTERS } from "../protocol.ts";
import type { ClaimDocument } from "./queue.ts";

interface ComposerProps {
  readonly draft: string;
  readonly attachments: readonly ClaimDocument[];
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly typing: string;
  readonly onDraft: (text: string) => void;
  readonly onRemoveAttachment: (name: string) => void;
  readonly onSubmit: () => void;
}

/** Tallest the message box grows before it scrolls. */
const MAX_HEIGHT = 240;

/**
 * The message box. A claim opened from the queue arrives here with its attachments as removable chips; nothing is
 * sent until the person presses Send (or Cmd/Ctrl+Enter). The box grows with its text.
 */
export function Composer({
  draft,
  attachments,
  placeholder,
  disabled,
  submitting,
  typing,
  onDraft,
  onRemoveAttachment,
  onSubmit,
}: ComposerProps) {
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !disabled && !submitting && draft.trim().length > 0;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    box.style.blockSize = "auto";
    box.style.blockSize = `${Math.min(box.scrollHeight + 2, MAX_HEIGHT)}px`;
  }, [draft]);

  const sendOnShortcut = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    if (canSend) onSubmit();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <div className="composer-box">
        <label className="visually-hidden" htmlFor="prompt">
          Message
        </label>
        <textarea
          ref={boxRef}
          id="prompt"
          name="prompt"
          rows={2}
          maxLength={MAX_PROMPT_CHARACTERS}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => onDraft(event.currentTarget.value)}
          onKeyDown={sendOnShortcut}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          disabled={disabled}
        />
        <div className="composer-footer">
          {attachments.length === 0 ? (
            <span />
          ) : (
            <ul className="composer-attachments" aria-label="Attachments">
              {attachments.map((document) => (
                <li key={document.name} className="composer-attachment">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12" />
                  </svg>
                  <span title={document.text}>{document.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${document.name}`}
                    onClick={() => onRemoveAttachment(document.name)}
                    disabled={submitting}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="button-primary button-send" type="submit" disabled={!canSend}>
            {submitting ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      <p className="typing-indicator" aria-live="polite">
        {typing}
      </p>
    </form>
  );
}
