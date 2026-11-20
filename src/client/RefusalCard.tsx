import type { Refusal } from "./decision-log.ts";

/** A turn BRANE refused (HTTP 422), shown as the next step for a person instead of a raw error. */
export function RefusalCard({ refusal }: { readonly refusal: Refusal }) {
  return (
    <article className="refusal-card" role="status">
      <span className="state state--blocked">
        <strong>Refused</strong>
      </span>
      <p>
        This request needs a person. BRANE refused it under <code>{refusal.rule}</code>.
      </p>
      {refusal.description === undefined && refusal.legalBasis === undefined ? null : (
        <p className="refusal-card-detail">
          {refusal.description === undefined ? null : `${refusal.description}. `}
          {refusal.legalBasis === undefined ? null : `Legal basis: ${refusal.legalBasis}.`}
        </p>
      )}
      <p className="refusal-card-detail">Nothing was sent to a model.</p>
    </article>
  );
}
