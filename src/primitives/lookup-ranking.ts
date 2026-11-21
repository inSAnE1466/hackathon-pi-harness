import type { Ranking } from "./rank.ts";

/** The ranking switches the lookup tool runs with: the ones the climb kept (evals/climb-history.json). */
export const DEFAULT_RANKING: Ranking = {
  stem: true,
  glossary: true,
  titleWeight: 2,
  diverse: false,
  split: false,
};
