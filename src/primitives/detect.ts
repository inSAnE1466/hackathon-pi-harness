import { GIVEN_NAMES } from "./names.ts";

/**
 * detect: deterministic checks, the pre-mask, that cover the gaps measured in BRANE's detectors
 * (evals/decision-log.md): a Dutch BSN is labeled ACCOUNT_NUMBER, a passport number is labeled ACCOUNT_NUMBER, a
 * policy number is labeled PERSON and only partly masked, a Dutch licence plate is not detected, and a person's name
 * or street address is missed on some runs and under load. Pure functions: same input, same answer, every time.
 *
 * `NAME`, `STREET`, `MAIL`, `TEL`, `BANK` and `BIRTH` are named so on purpose: BRANE's own placeholders are `<PERSON_1>`,
 * `<ADDRESS_1>`, `<EMAIL_1>`, `<PHONE_1>` and `<IBAN_1>`, and it puts the real value back into the answer for those.
 * A token of ours with the same spelling would come back as the wrong value.
 */
export type Finding = {
  readonly kind:
    | "BSN"
    | "POLICY_ID"
    | "CLAIM_ID"
    | "PASSPORT"
    | "PLATE"
    | "NAME"
    | "STREET"
    | "MAIL"
    | "TEL"
    | "BANK"
    | "BIRTH";
  readonly text: string;
  /** What makes two findings the same thing, e.g. "Jan de Vries" and "J. de Vries". Default: the text. */
  readonly key?: string;
};

/** The Dutch BSN "11-proof": 9 digits, weights 9..2 and -1, sum divisible by 11. */
export function isBsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits) || digits === "000000000") return false;
  const d = [...digits].map(Number);
  const sum = d.slice(0, 8).reduce((s, x, i) => s + x * (9 - i), 0) - d[8];
  return sum % 11 === 0;
}

type Span = Finding & { readonly start: number; readonly end: number };

const fold = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function identifierSpans(text: string): Span[] {
  const found: Span[] = [];
  const add = (kind: Finding["kind"], value: string, start: number) =>
    found.push({ kind, text: value, start, end: start + value.length });
  for (const m of text.matchAll(/(?<![\d-])(\d{3}[ .]?\d{2}[ .]?\d{4}|\d{9})(?![\d-])/g)) {
    if (isBsn(m[1]!.replace(/[ .]/g, ""))) add("BSN", m[1]!, m.index);
  }
  for (const m of text.matchAll(/\bPOL-\d{4}-\d{2}\b/g)) add("POLICY_ID", m[0], m.index);
  for (const m of text.matchAll(/\bCLM-\d{4}-\d{4}\b/g)) add("CLAIM_ID", m[0], m.index);
  for (const m of text.matchAll(/\bpassport(?: number)?:?\s+([A-Z]{2}[A-Z0-9]{6,7})\b/gi)) {
    add("PASSPORT", m[1]!, m.index + m[0].length - m[1]!.length);
  }
  // Dutch licence plates (sidecode formats such as 12-ABC-3, AB-123-C, 1-ABC-23); BRANE does not detect them.
  for (const m of text.matchAll(
    /\b(?:\d{1,2}-[A-Z]{2,3}-\d{1,2}|[A-Z]{1,2}-\d{2,3}-[A-Z]{1,2}|\d{2}-[A-Z]{2}-[A-Z]{2}|[A-Z]{2}-[A-Z]{2}-\d{2})\b/gi,
  )) {
    add("PLATE", m[0], m.index);
  }
  // Email addresses, IBANs and phone numbers: BRANE finds them on most runs; under load it finds nothing.
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add("MAIL", m[0], m.index);
  for (const m of text.matchAll(
    /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
  )) {
    if (/\d{6}/.test(m[0].replace(/ /g, ""))) add("BANK", m[0], m.index);
  }
  for (const m of text.matchAll(
    /(?<![\w-])(?:\+\d{1,3}[ -]?(?:\(0\)[ -]?)?|\b00\d{2}[ -]?|\b0)\d(?:[ -]?\d){7,10}(?![\d-])/g,
  ))
    add("TEL", m[0], m.index);
  // A date of birth: a full date after "born", "geboren", "geb.", "date of birth" or "DOB".
  for (const m of text.matchAll(
    /\b(?:born(?: on)?|geboren(?: op)?|geb\.?|date of birth|geboortedatum|dob)[:,]?[ \t]+(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2} \p{L}{3,9} \d{4})/giu,
  ))
    add("BIRTH", m[1]!, m.index + m[0].length - m[1]!.length);
  return found;
}

type Word = { readonly text: string; readonly start: number; readonly end: number };

/** A capitalized word of two letters or more, such as a name: "Vries", "El-Amrani", "McDonald". Not "EUR". */
const isCapitalized = (word: string): boolean =>
  /^\p{Lu}[\p{L}\p{M}'’-]*\p{Ll}[\p{L}\p{M}'’-]*$/u.test(word);

/** Name particles between a given name and a surname: "de", "van der", "ter", "el", "al". */
const PARTICLES = new Set(
  "van von de den der het ter ten te el al bin ben di da du del della le la dos das op 't".split(
    " ",
  ),
);

/** Capitalized words that start sentences or name things, never a surname here. */
const NOT_A_NAME = new Set(
  `the this that these those it he she we they you in on at for from to with by if when while after before and but
  or so as of an is are was were has have had will can may please check draft summarise summarize explain prepare
  send reject approve pay list note write read review compare flag go give show tell ask call find make use see
  dear synthetic claim claims policy invoice hospital clinic total payout refund report letter contact claimant
  policyholder insured customer service travel health motor medical legal adviser advisor handler reviewer team our
  your his her their its my no yes not also then there here what which who how why where january february march
  april june july august september october november december monday tuesday wednesday thursday friday saturday
  sunday de het een en maar als dat dit deze die hij zij wij ik je op aan voor van met bij naar om er zijn heeft
  graag beste geachte betreft der das und eur euro insurance insurer airline airport embassy police court bank
  university station hotel pharmacy ziekenhuis kliniek centrum center centre group company ltd bv nv gmbh
  street road avenue lane square north south east west new old saint sint san international national european
  europe netherlands dutch german french belgian spanish italian turkish moroccan english british article section
  annex recital regulation directive act law gdpr`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** Given names that are also ordinary capitalized words; masked with a surname or after a cue, not alone. */
const NOT_ALONE = new Set(
  `mark max will grace frank jack floor roos iris amber ruby lily rosa luna ward mason stan sterre puck sem
  august art said bas victoria christian jean marie karl leo sam bo can may june april roy rob`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** Words after which a capitalized sequence is a person: a title, a role in a claim, a relative. */
const PERSON_CUES = new Set(
  `mr mrs ms miss mx dr prof sir madam madame monsieur mme herr frau mevrouw mevr mw meneer mijnheer dhr heer
  policyholder claimant insured patient driver passenger witness beneficiary applicant tenant owner landlord
  neighbour neighbor colleague employee employer complainant victim suspect debtor payee payer
  son daughter sister brother wife husband partner mother father spouse child uncle aunt grandmother grandfather
  nephew niece cousin friend fiancee fiance widow widower guardian
  zoon dochter zus broer echtgenoot echtgenote moeder vader buurman buurvrouw verzekerde verzekeringnemer
  bestuurder getuige eiser named name naam signed regards sincerely groet groeten`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** Titles: after one, a name counts even when it is typed without capitals. */
const PERSON_TITLES = new Set(
  "mr mrs ms miss mx dr mevrouw mevr mw meneer mijnheer dhr herr frau".split(" "),
);

/** Words that follow a name in a sentence and are not a surname, for text typed without capitals. */
const FOLLOWS_A_NAME = new Set(
  `called calls asked asks reports reported says said wants wanted needs needed filed files again gives gave has had
  have is was were are will would can could should did does and or but who whose with from for about lives lived
  born sent paid claims claimed wrote writes signed slipped fell broke lost bought needs asks again also then now
  today yesterday born aged plus got gets went came took made left stayed`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** Verbs before "by" that make the next capitalized sequence a person: "hit by Pieter Jansen". */
const BY_VERBS = new Set(
  `hit signed called reported treated injured driven owned caused represented witnessed examined seen written sent
  filed submitted paid struck attacked accompanied assisted confirmed prescribed referred`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

const STREET_ENDINGS =
  /(?:straat|weg|laan|plein|gracht|kade|dijk|singel|hof|pad|steeg|dreef|markt|plantsoen|park|baan|wal|stra(?:ß|ss)e|gasse|allee|platz)$/i;

/** The words of a text with their positions, and what stands between two of them. */
function wordsOf(text: string): Word[] {
  return [...text.matchAll(/\p{L}[\p{L}\p{M}'’-]*/gu)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

function nameSpans(text: string): Span[] {
  const words = wordsOf(text);
  const found: Span[] = [];
  const gap = (i: number): string =>
    i + 1 < words.length ? text.slice(words[i]!.end, words[i + 1]!.start) : "\n";
  const isInitial = (i: number): boolean =>
    /^\p{Lu}$/u.test(words[i]!.text) && text[words[i]!.end] === ".";
  /** Only spaces between word `i` and the next one; after an initial, its full stop too. */
  const joined = (i: number): boolean =>
    isInitial(i) ? /^\.[ \t]*$/.test(gap(i)) : /^[ \t]+$/.test(gap(i));
  const lower = (i: number): string => words[i]!.text.toLowerCase();
  const isGiven = (i: number): boolean =>
    isCapitalized(words[i]!.text) && GIVEN_NAMES.has(fold(words[i]!.text));
  /** In text typed without capitals: a listed given name that is not also an ordinary word. */
  const isLowerGiven = (i: number): boolean =>
    /^\p{Ll}+$/u.test(words[i]!.text) &&
    GIVEN_NAMES.has(fold(words[i]!.text)) &&
    !NOT_ALONE.has(lower(i));
  /** Typed without capitals: "jan de vries", "j. de vries" after a known name, "mr de vries". */
  const lowerNameAt = (i: number, cue: boolean): { last: number; key: string } | undefined => {
    const given = isLowerGiven(i);
    if (!given && !cue) return undefined;
    let p = given ? i + 1 : i;
    if (given && !joined(i)) return { last: i, key: `|${fold(words[i]!.text)}` };
    const particles: number[] = [];
    while (p < words.length && particles.length < 3 && PARTICLES.has(lower(p)) && joined(p)) {
      particles.push(p);
      p += 1;
    }
    const surname =
      p < words.length &&
      /^\p{Ll}[\p{L}'’-]{2,}$/u.test(words[p]!.text) &&
      !NOT_A_NAME.has(lower(p)) &&
      !FOLLOWS_A_NAME.has(lower(p));
    if (!surname) return given ? { last: i, key: `|${fold(words[i]!.text)}` } : undefined;
    return {
      last: p,
      key: `${[...particles, p].map((k) => fold(words[k]!.text)).join(" ")}|${given ? fold(words[i]!.text).charAt(0) : ""}`,
    };
  };
  const isSurname = (i: number): boolean =>
    isCapitalized(words[i]!.text) && !NOT_A_NAME.has(lower(i)) && !PERSON_CUES.has(lower(i));

  /**
   * A name starting at word `i`: given names or initials, particles, a surname. With `loose`, after a cue, the
   * first word may be any capitalized word and one or two more may follow.
   */
  const nameAt = (i: number, loose: boolean): { last: number; key: string } | undefined => {
    let at = i;
    const front: number[] = [];
    while (at < words.length && front.length < 4 && (isInitial(at) || isGiven(at))) {
      front.push(at);
      if (!joined(at)) break;
      at += 1;
    }
    const afterFront = front.length === 0 ? i : front.at(-1)! + 1;
    const connected = front.length === 0 || joined(front.at(-1)!);
    // Particles, then the surname.
    let p = afterFront;
    const particles: number[] = [];
    while (
      connected &&
      p < words.length &&
      particles.length < 3 &&
      PARTICLES.has(lower(p)) &&
      joined(p)
    ) {
      particles.push(p);
      p += 1;
    }
    const initial = front.length === 0 ? "" : fold(words[front[0]!]!.text).charAt(0);
    if (connected && p < words.length && isSurname(p) && (front.length > 0 || loose)) {
      let last = p;
      // After a cue the name may be made of words the list does not know: take up to two more.
      if (loose && front.length === 0) {
        while (last - p < 2 && joined(last) && last + 1 < words.length && isSurname(last + 1))
          last += 1;
        if (last > p) {
          const surname = words
            .slice(p + 1, last + 1)
            .map((w) => fold(w.text))
            .join(" ");
          return { last, key: `${surname}|${fold(words[p]!.text).charAt(0)}` };
        }
      }
      const surname = [...particles, p].map((k) => fold(words[k]!.text)).join(" ");
      return { last, key: `${surname}|${initial}` };
    }
    // No surname. A given name alone counts, unless it is also an ordinary word; initials alone never do.
    const given = front.filter((k) => !isInitial(k));
    if (given.length === 0) return undefined;
    if (!loose && given.length === 1 && NOT_ALONE.has(lower(given[0]!))) return undefined;
    return { last: given.at(-1)!, key: `|${fold(words[given[0]!]!.text)}` };
  };

  for (let i = 0; i < words.length; i++) {
    const cue =
      i > 0 &&
      /^\.?[ \t]*[:,]?[ \t]+$/.test(gap(i - 1)) &&
      (PERSON_CUES.has(lower(i - 1)) ||
        (lower(i - 1) === "by" && i > 1 && BY_VERBS.has(lower(i - 2))));
    const name = nameAt(i, cue) ?? lowerNameAt(i, cue && PERSON_TITLES.has(lower(i - 1)));
    if (name === undefined) continue;
    const start = words[i]!.start;
    // An initial keeps its full stop when it ends the name.
    const end = words[name.last]!.end;
    found.push({ kind: "NAME", text: text.slice(start, end), key: name.key, start, end });
    i = name.last;
  }
  return found;
}

function streetSpans(text: string): Span[] {
  const words = wordsOf(text);
  const found: Span[] = [];
  const add = (start: number, end: number, key: string) =>
    found.push({ kind: "STREET", text: text.slice(start, end), key: fold(key), start, end });
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!STREET_ENDINGS.test(word.text)) continue;
    // Typed without a capital, the word must be more than the ending itself: "kerkstraat", not "weg".
    if (!/^\p{Lu}/u.test(word.text) && word.text.replace(STREET_ENDINGS, "").length < 3) continue;
    // A house number, not a year: "Kerkstraat 14", "Markt 12a", "Dorpsweg 3-5".
    const number =
      /^[ \t]+(?!(?:19|20)\d\d\b)(\d{1,4}(?:[ \t]?[a-zA-Z]\b|-\d{1,4})?)(?![\d.,]\d)/.exec(
        text.slice(word.end, word.end + 16),
      );
    if (number === null) continue;
    // Up to two capitalized words before it belong to the street: "Prins Hendriklaan", "Oude Kerkstraat".
    let first = i;
    while (
      first > 0 &&
      i - first < 2 &&
      /^[ \t]+$/.test(text.slice(words[first - 1]!.end, words[first]!.start)) &&
      isCapitalized(words[first - 1]!.text) &&
      !NOT_A_NAME.has(words[first - 1]!.text.toLowerCase())
    )
      first -= 1;
    const start = words[first]!.start;
    let end = word.end + number[0].length;
    const key = text.slice(start, end);
    // A postcode and a town after it are part of the address.
    const tail =
      /^,?[ \t]+(?:[1-9]\d{3}[ \t]?[A-Za-z]{2}\b)?(?:,?[ \t]*\p{Lu}[\p{L}'’-]+(?:[ \t-]\p{Lu}[\p{L}'’-]+)?|(?<=,[ \t]*|\d{4}[ \t]?[a-z]{2}[ \t]+)\p{Ll}{3,})?/u.exec(
        text.slice(end, end + 60),
      );
    if (tail !== null && /\p{L}|\d/u.test(tail[0])) {
      const town = /(\p{L}[\p{L}'’-]+)(?:[ \t-]\p{Lu}[\p{L}'’-]+)?$/u.exec(tail[0]);
      if (town === null || !NOT_A_NAME.has(town[1]!.toLowerCase())) end += tail[0].length;
      else end += tail[0].length - town[0].length;
      end = text.slice(0, end).trimEnd().replace(/,$/, "").length;
    }
    add(start, end, key);
  }
  // House number first, or a street word first: "10 Downing Street", "Rue de la Loi 16", "16 rue de la Loi".
  for (const m of text.matchAll(
    /\b\d{1,4},?[ \t](?:\p{Lu}[\p{L}'’-]+[ \t]){1,3}(?:Street|Road|Avenue|Lane|Drive|Square|Close|Court|Way)\b/gu,
  ))
    add(m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(
    /(?:\b\d{1,4},?[ \t])?\b(?:Rue|Avenue|Boulevard|Place|Via|Viale|Piazza|Calle|Avenida|Plaza|Rua)[ \t](?:(?:de|du|des|del|della|di|la|le|las|los)[ \t]){0,2}(?:l'|d')?\p{Lu}[\p{L}'’-]+(?:[ \t]\p{Lu}[\p{L}'’-]+)?(?:,?[ \t]\d{1,4}\b)?/giu,
  )) {
    if (/\d/.test(m[0])) add(m.index, m.index + m[0].length, m[0]);
  }
  // A Dutch postcode on its own: 6211 AB.
  for (const m of text.matchAll(
    /(?<![\d-])(?!(?:19|20)\d\d)[1-9]\d{3}[ \t]?[A-Z]{2}(?![\p{L}\d])/gu,
  ))
    add(m.index, m.index + m[0].length, m[0]);
  return found;
}

/**
 * Everything the pre-mask replaces in a text, in reading order: identifiers, street addresses, person names. Where
 * two overlap, the one that starts first wins, and of two that start together the longer.
 */
export function findIdentifiers(text: string): Finding[] {
  const spans = [...identifierSpans(text), ...streetSpans(text), ...nameSpans(text)].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const kept: Span[] = [];
  for (const span of spans)
    if (kept.length === 0 || span.start >= kept.at(-1)!.end) kept.push(span);
  return kept.map(({ kind, text: value, key }) => ({
    kind,
    text: value,
    ...(key === undefined ? {} : { key }),
  }));
}

/**
 * The tokens of one conversation: the same value gets the same token in every request, tool result and message, so
 * `<NAME_1>` never means two people. The harness keeps one per conversation in the session's storage. It holds the
 * real values and is never sent to a model.
 */
export class Tokens {
  readonly #byKey = new Map<string, { readonly token: string; readonly text: string }>();
  readonly #count = new Map<string, number>();
  readonly #onAdd: (key: string, token: string, text: string) => void;

  constructor(
    stored: Iterable<{ readonly key: string; readonly token: string; readonly text: string }> = [],
    onAdd: (key: string, token: string, text: string) => void = () => {},
  ) {
    this.#onAdd = onAdd;
    for (const { key, token, text } of stored) this.#remember(key, token, text);
  }

  #remember(key: string, token: string, text: string): void {
    this.#byKey.set(key, { token, text });
    const kind = key.slice(0, key.indexOf(":"));
    this.#count.set(kind, (this.#count.get(kind) ?? 0) + 1);
  }

  /** Token and first-seen value of everything replaced so far. */
  entries(): { readonly token: string; readonly text: string }[] {
    return [...this.#byKey.values()];
  }

  /** The surnames seen so far, with their tokens: a later bare "de Vries" is the same person. */
  surnames(): { readonly surname: string; readonly token: string }[] {
    const out: { surname: string; token: string }[] = [];
    for (const [key, { token }] of this.#byKey) {
      const surname = /^NAME:([^|]+)\|/.exec(key)?.[1];
      if (surname !== undefined && !out.some((o) => o.surname === surname))
        out.push({ surname, token });
    }
    return out;
  }

  tokenFor(finding: Finding): string {
    const key = `${finding.kind}:${finding.key ?? finding.text}`;
    const known = this.#byKey.get(key) ?? this.#samePerson(finding);
    if (known !== undefined) return known.token;
    const token = `<${finding.kind}_${(this.#count.get(finding.kind) ?? 0) + 1}>`;
    this.#remember(key, token, finding.text);
    this.#onAdd(key, token, finding.text);
    return token;
  }

  /** "J. de Vries", "Jan de Vries" and "Mr de Vries" are one person; so is a later "Jan" on its own. */
  #samePerson(finding: Finding): { readonly token: string } | undefined {
    if (finding.kind !== "NAME" || finding.key === undefined) return undefined;
    const [surname, initial] = finding.key.split("|") as [string, string];
    for (const [key, value] of this.#byKey) {
      if (!key.startsWith("NAME:")) continue;
      const [otherSurname, otherInitial] = key.slice(5).split("|") as [string, string];
      if (surname === "") {
        // A given name alone: the person whose name starts with it.
        if (fold(value.text).split(" ")[0] === initial) return value;
      } else if (
        otherSurname === surname &&
        (initial === "" || otherInitial === "" || otherInitial.charAt(0) === initial.charAt(0))
      )
        return value;
    }
    return undefined;
  }
}

/**
 * Replace each finding with a stable token, so a payload can go to the cloud without the value. With `tokens`, the
 * conversation's own, values seen before keep their token and a surname seen before is replaced where it stands
 * alone.
 */
export function mask(
  text: string,
  findings: readonly Finding[],
  tokens: Tokens = new Tokens(),
): string {
  // Tokens are numbered in reading order; values are replaced longest first, so one inside another survives.
  const replacements = new Map<string, string>();
  for (const f of findings)
    if (!replacements.has(f.text)) replacements.set(f.text, tokens.tokenFor(f));
  let out = text;
  for (const [value, token] of [...replacements].sort((a, b) => b[0].length - a[0].length))
    out = out.split(value).join(token);
  for (const { surname, token } of tokens.surnames()) {
    const words = surname.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const last = words.pop()!;
    if (last.length < 3) continue;
    // The surname as a capitalized word, with its particles when they are there.
    const pattern = new RegExp(
      `(?<![\\p{L}<_])${words.map((w) => `(?:${w}[ \\t]+)?`).join("")}${last}(?![\\p{L}_>@.]\\p{L}|[\\p{L}_>@])`,
      "giu",
    );
    out = out.replace(pattern, (match) =>
      /\p{Lu}/u.test(
        match
          .trimStart()
          .split(/[ \t]+/)
          .at(-1)!
          .charAt(0),
      ) && fold(match).endsWith(fold(last))
        ? token
        : match,
    );
  }
  return out;
}

/**
 * The second classifier's pure half. The spec (prompt template, label definitions, label to route) lives in
 * policy/classifier.json; the caller runs the prompt on BRANE's local model through a local-only draft policy, so
 * the text never leaves, and passes the reply here. The classifier can only make a route stricter.
 */
export type Outcome = "allow" | "protect" | "local" | "refuse";
export type ClassifierSpec = {
  readonly version: string;
  readonly template: string;
  /** The labels that move a route. Labels left out are reported but ignored (BRANE already handles them). */
  readonly counted?: readonly string[];
  readonly labels: Readonly<
    Record<string, { readonly route: Outcome; readonly definition: string }>
  >;
};
export type Verdict = { readonly labels: readonly string[]; readonly route: Outcome };

const RANK: Readonly<Record<Outcome, number>> = { allow: 0, protect: 1, local: 2, refuse: 3 };

/** The stricter of two outcomes. */
export const stricter = (a: Outcome, b: Outcome): Outcome => (RANK[a] >= RANK[b] ? a : b);

/** The prompt for one text: every label with its definition, the text fenced as data. */
export function classifierPrompt(spec: ClassifierSpec, text: string): string {
  const names = Object.keys(spec.labels);
  return spec.template
    .replace("{definitions}", names.map((l) => `- ${l}: ${spec.labels[l].definition}`).join("\n"))
    .replace("{keys}", names.map((l) => `"${l}": 0`).join(", "))
    .replace("{text}", () => text);
}

/**
 * Read the model's reply: one JSON object with every label as 0 or 1. A reply that cannot be read, or that lacks a
 * label, yields route "local" with no labels: a failed classifier never loosens a route.
 */
export function readVerdict(spec: ClassifierSpec, reply: string | null | undefined): Verdict {
  const failed: Verdict = { labels: [], route: "local" };
  const match = /\{[\s\S]*\}/.exec(reply ?? "");
  if (!match) return failed;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return failed;
  }
  const labels: string[] = [];
  for (const name of Object.keys(spec.labels)) {
    const value = parsed[name];
    if (value === undefined) return failed;
    if (/^(1|true|yes)$/i.test(String(value).trim())) labels.push(name);
  }
  const counted = labels.filter((l) => spec.counted?.includes(l) ?? true);
  return { labels, route: counted.map((l) => spec.labels[l].route).reduce(stricter, "allow") };
}
