import { describe, expect, it } from "vitest";
import { findIdentifiers, mask, Tokens } from "../src/primitives/detect.ts";

const masked = (text: string, tokens?: Tokens): string => mask(text, findIdentifiers(text), tokens);

describe("pre-mask: names, addresses and contact details", () => {
  it("leaves a request without personal data untouched (T1)", () => {
    const control =
      "Explain in plain words what the 'own risk' (eigen risico) clause in a Dutch health insurance policy means for a claim of EUR 300.";
    expect(findIdentifiers(control)).toEqual([]);
    expect(masked(control)).toBe(control);
    for (const text of [
      "Check Article 22 GDPR and the EU AI Act, Annex III. Invoice from Maastricht UMC+ for EUR 840 on 3 May 2026.",
      "Zara Lisboa, 15 Aug: clothing EUR 214.00. Embassy of the Netherlands, Lisbon. Total EUR 650.00.",
      "The policyholder asks for nine sessions to be reimbursed. Mark the file as complete in March 2026.",
    ])
      expect(findIdentifiers(text)).toEqual([]);
  });

  it("masks a name, email, phone number and IBAN (T2)", () => {
    const out = masked(
      "Synthetic claim CLM-2026-4471: Jan de Vries (jan.devries@example.nl, +31 6 12345678) reports water damage. Payout to NL91ABNA0417164300.",
    );
    expect(out).toBe(
      "Synthetic claim <CLAIM_ID_1>: <NAME_1> (<MAIL_1>, <TEL_1>) reports water damage. Payout to <BANK_1>.",
    );
  });

  it("gives every mention of one person the same token, the variant too (T3)", () => {
    const out = masked(
      "Jan de Vries (jan.devries@example.nl) filed claim CLM-2026-4471. In the second letter, Jan de Vries again gives jan.devries@example.nl and asks that J. de Vries be called. Mr de Vries agrees.",
    );
    expect(out).not.toMatch(/Vries|Jan\b|devries/);
    expect(out.match(/<NAME_1>/g)).toHaveLength(4);
    expect(out).not.toContain("<NAME_2>");
  });

  it("masks a third party's name, plate and street address (E5)", () => {
    const out = masked(
      "Our policyholder was hit by Pieter Jansen (licence plate 12-ABC-3), who lives at Kerkstraat 14, Maastricht.",
    );
    expect(out).toBe(
      "Our policyholder was hit by <NAME_1> (licence plate <PLATE_1>), who lives at <STREET_1>.",
    );
  });

  it("finds names the list does not know after a person cue, and names typed without capitals", () => {
    expect(masked("Claimant: Xiomara Quispe. Signed by Dr. Okonkwo.")).toBe(
      "Claimant: <NAME_1>. Signed by Dr. <NAME_2>.",
    );
    expect(masked("jan de vries called; mr de vries lives at molenweg 7, sittard.")).not.toMatch(
      /vries|molenweg|sittard/,
    );
    expect(masked("Mevrouw Yilmaz-de Boer, Prins Hendriklaan 12a, 6211 AB Maastricht.")).toBe(
      "Mevrouw <NAME_1>, <STREET_1>.",
    );
  });

  it("keeps one token per value across the messages of a conversation", () => {
    const tokens = new Tokens();
    const first = masked("Claim CLM-2026-4471 from Jan de Vries, BSN 123456782.", tokens);
    const other = masked("The witness is Fatima El Idrissi, BSN 111222333.", tokens);
    const second = masked(
      "J. de Vries called again about CLM-2026-4471. De Vries wants a call back.",
      tokens,
    );
    expect(first).toBe("Claim <CLAIM_ID_1> from <NAME_1>, BSN <BSN_1>.");
    expect(other).toBe("The witness is <NAME_2>, BSN <BSN_2>.");
    expect(second).toBe("<NAME_1> called again about <CLAIM_ID_1>. <NAME_1> wants a call back.");
    // A stored map gives the same tokens after a restart.
    const stored: { key: string; token: string; text: string }[] = [];
    const a = new Tokens([], (key, token, text) => stored.push({ key, token, text }));
    masked("Jan de Vries and Pieter Jansen.", a);
    expect(masked("Pieter Jansen wrote to J. de Vries.", new Tokens(stored))).toBe(
      "<NAME_2> wrote to <NAME_1>.",
    );
  });

  it("gives the same answer every time", () => {
    const text = "Sanne Bakker, Dorpsstraat 3, 6211 AB Maastricht, sanne@example.nl, 06 12345678.";
    expect(new Set(Array.from({ length: 5 }, () => masked(text))).size).toBe(1);
    expect(masked(text)).not.toMatch(/Sanne|Bakker|Dorpsstraat|6211|example|12345678/);
  });
});
