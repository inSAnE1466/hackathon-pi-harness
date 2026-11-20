---
name: pstack
description: "Use pstack as the engineering workflow in this repository. Select a playbook, read the principles it needs, and prove the result on the real surface."
---

# pstack

pstack is Lauren Tan's engineering workflow (MIT, pinned copy in `.agents/vendor/pstack/`, read-only; provenance in
`.agents/vendor/pstack/PROVENANCE.md`). The repository [AGENTS.md](../../../AGENTS.md) outranks it.

## Every task

1. Pick one playbook from `.agents/vendor/pstack/skills/poteto-mode/playbooks/`. Copy its steps into a todo list.
   Keep a skipped step as `skip: <reason>`.
2. Before writing logic, read the principle leaves (`.agents/vendor/pstack/skills/principle-*/SKILL.md`) that apply.
   Name each one in your reply and the choice it changed.
3. Name the data shape before code. Prefer deleting to adding. Build the script that does or proves non-trivial work.
4. Prove the result on the real surface and report the command and its output.
5. Write prose with `.agents/vendor/pstack/skills/unslop/SKILL.md`.

| Task                                                        | Playbook                               |
| ----------------------------------------------------------- | -------------------------------------- |
| Read-only question                                          | `investigation.md`                     |
| Defect                                                      | `bug-fix.md`                           |
| New or changed behavior                                     | `feature.md`                           |
| Cleanup without behavior change                             | `refactoring.md`                       |
| A fork an experiment can settle                             | `prototype.md`                         |
| Climbing one metric (policy conditions, classifier prompts) | `hillclimb.md`                         |
| Comparing variants with a blinded judge                     | `eval.md`                              |
| Multi-step plan                                             | `multi-phase-plan.md`                  |
| Resume or pause work                                        | `session-pickup.md`, `pause-safely.md` |

## Adaptations

- Upstream names such as Cursor cloud agents, `subagent_type`, Bugbot and specific model names are examples. Use
  whatever agent tool you run (Pi, Claude Code, Codex) with the same discipline.
- `pnpm check && pnpm test` replaces assumed CI. The mainline is `main`.
- Never run `/setup-pstack`.
