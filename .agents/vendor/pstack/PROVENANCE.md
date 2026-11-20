# pstack provenance

Pinned copy of pstack, Lauren Tan's engineering-workflow skills, kept here as the authority for how
agent work is planned, executed, verified and reviewed across the registered repositories.
Local adaptations live in `.agents/skills/pstack/`; this directory stays unmodified.

| Field | Value |
| --- | --- |
| Upstream | https://github.com/cursor/plugins, directory `pstack/` |
| Pinned commit | `ccb5507cec1546dc88135c1139c811e6c59115ba` (2026-10-07) |
| Version | 0.15.15 (upstream plugin metadata) |
| Licence | MIT, Copyright (c) 2026 Lauren Tan |
| Vendored | 2026-10-08 |
| Contents | 51 skills, 23 playbooks, 24 principles |

## Included

- `skills/` and `docs/guide/`, unmodified.
- `README.md` and `LICENSE`.

## Excluded

- upstream `docs/guide/images/` and `assets/`. Screenshots and logos with no text.
- `.cursor-plugin/plugin.json`, because its upstream logo reference points to the excluded `assets/` tree.
- `agents/`. Cursor subagent definitions that route to Cursor models. Work here routes to native
  Codex subagents instead, so the Cursor wrappers do not apply.
- `automations/`. Cursor Automation definitions, which no host in this workspace runs.

## Reading it

The skills reference each other by name (`principle-*`, `how`, `why`, `swarm`, and the playbooks
under `poteto-mode/playbooks/`). Upstream text writes paths as `pstack/skills/...`; here the same
files sit under `.agents/vendor/pstack/skills/...`.

## Updating

Fetch the named commit from `https://github.com/cursor/plugins.git` into a temporary checkout.
Copy the included paths from its `pstack/` directory without editing upstream files. Retain the
license, record the new revision here, and review the repository adapter at
[`.agents/skills/pstack/SKILL.md`](../../skills/pstack/SKILL.md).

For this revision, the immutable source archive is
`https://github.com/cursor/plugins/archive/ccb5507cec1546dc88135c1139c811e6c59115ba.tar.gz`.
This workspace retains one reviewed copy. Consumer repositories link to the workspace adapter;
native user-skill links expose the selected upstream skills without copying this tree.
