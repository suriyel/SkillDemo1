# Blueprint: my-test

Self-contained TechDemos blueprint (engine schemaVersion 1).

- `blueprint.json` — DAG topology
- `meta.json` — skill provenance (originalRef → newRef mapping)
- `skills/<name>/SKILL.md` — bundled claude skills
- `opencode-skills/<name>/SKILL.md` — bundled opencode skills

Run via the harness UI (🗺️ 工作流 panel) or the `/_blueprint/*` HTTP API.
