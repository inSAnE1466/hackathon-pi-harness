import type { ClaimDocument } from "./queue.ts";

/** A claim as it arrived: the request, then each attachment as a chip that opens to its text. */
export function ClaimMessage({
  request,
  documents,
}: {
  readonly request: string;
  readonly documents: readonly ClaimDocument[];
}) {
  return (
    <div className="claim-message">
      <p>{request}</p>
      {documents.length === 0 ? null : (
        <ul className="attachments" aria-label="Attachments">
          {documents.map((document) => (
            <li key={document.name}>
              <details className="attachment">
                <summary>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12" />
                  </svg>
                  {document.name}
                </summary>
                <p>{document.text}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
