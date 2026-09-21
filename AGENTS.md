## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Read `.codex/skills/graphify/SKILL.md` when Graphify is explicitly requested. Read `docs/project-context.md` for current decisions and operational limits.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `npm run context:refresh`, then `npm run context:check`. This project wrapper preserves curated context, enforces a source allowlist, and makes no model API calls. Use it instead of a broad `graphify update .`.
- Confirm graph findings in source before editing. If Graphify is unavailable, use the context document and targeted source reads; do not block an unrelated task or install tools silently.
- Update `docs/project-context.md` and `docs/context-graph.json` when decisions or architecture change. Historical audit figures are not current verification results.
- Never index credentials, `.env` files, business records, backups, or `whatsapp-cron/Code.gs`. Never seed, reset, or backfill production as a test. Graphify is project context, not ledger storage.
- Do not enable external semantic APIs or change global Codex configuration. The optional project hook only supplies query guidance; there is no automatic git hook or production mutation.
