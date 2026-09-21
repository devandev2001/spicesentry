"""Build a portable Graphify map from source files only; never call model APIs."""
from collections import Counter
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "graphify-out"
VERSION = "0.8.36"
os.chdir(ROOT)


def source_files():
    """Positive allowlist avoids indexing data exports even if ignore rules drift."""
    paths = set()
    for folder in ("src", "server", "tests"):
        for suffix in ("*.js", "*.jsx", "*.mjs"):
            paths.update(Path(folder).rglob(suffix))
    paths.update(Path("scripts").glob("*.mjs"))
    paths.update(Path("docs").glob("*.md"))
    paths.update(Path(name) for name in (
        "README.md", "AGENTS.md", "package.json", "vite.config.js", "eslint.config.js",
        "public/sw.js", "mcp-server/index.js", "docs/context-graph.json",
        "scripts/build-context.py", ".graphifyignore",
    ))
    # Historical reports remain accessible but must not be promoted to current facts.
    paths.discard(Path("docs/application-audit-2026-09-21.md"))
    accepted = []
    for path in sorted(paths):
        if not path.is_file() or path.is_symlink():
            continue
        if not path.resolve().is_relative_to(ROOT):
            raise SystemExit("Context source escapes the repository")
        lowered = str(path).lower()
        if any(term in lowered for term in ("credential", "service-account", "firebase-adminsdk", "backup", ".env", "node_modules")):
            continue
        accepted.append(path)
    return accepted


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def portable(value):
    if isinstance(value, dict):
        return {key: portable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [portable(item) for item in value]
    if isinstance(value, str):
        return value.replace(str(ROOT) + "/", "").replace(str(ROOT), ".")
    return value


paths = source_files()
hashes = {str(path): digest(path) for path in paths}
manifest_path = OUT / "sources.json"
if "--check" in sys.argv:
    if not manifest_path.exists():
        raise SystemExit("Context graph is missing. Run npm run context:refresh.")
    previous = json.loads(manifest_path.read_text())
    if previous.get("sources") != hashes:
        changed = sorted(set(hashes) | set(previous.get("sources", {})))
        changed = [name for name in changed if hashes.get(name) != previous.get("sources", {}).get(name)]
        raise SystemExit("Context is stale: " + ", ".join(changed) + ". Run npm run context:refresh.")
    for name, checksum in previous.get("artifacts", {}).items():
        artifact = OUT / name
        if not artifact.is_file() or digest(artifact) != checksum:
            raise SystemExit("Context artifact changed or missing: " + name)
    print(f"Context current: {len(paths)} source files; graph artifacts verified.")
    raise SystemExit(0)

try:
    installed = importlib.metadata.version("graphifyy")
except importlib.metadata.PackageNotFoundError:
    raise SystemExit("Install Graphify first: uv tool install --python 3.12 graphifyy==" + VERSION)
if installed != VERSION:
    raise SystemExit(f"Expected graphifyy {VERSION}, found {installed}. Review upgrades before rebuilding.")

# These modules do local structural extraction/export only. Do not import llm or ingest.
from graphify.extract import extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_html

OUT.mkdir(exist_ok=True)
code = [path for path in paths if path.suffix in (".js", ".jsx", ".mjs", ".py")]
documents = [path for path in paths if path.suffix == ".md"]
words = sum(len(path.read_text().split()) for path in code + documents)
print(f"Corpus: {len(code)} code files, {len(documents)} documents, approximately {words:,} words.")
if len(paths) > 500 or words > 2_000_000:
    raise SystemExit("Context corpus exceeded review limits; narrow the allowlist before rebuilding.")

ast = portable(extract(code, cache_root=ROOT, parallel=False))
semantic = json.loads(Path("docs/context-graph.json").read_text())
nodes = {node["id"]: node for node in ast["nodes"]}
nodes.update({node["id"]: node for node in semantic["nodes"]})
edges = ast["edges"] + semantic["edges"]
extraction = {"nodes": list(nodes.values()), "edges": edges, "hyperedges": semantic.get("hyperedges", [])}
graph = build_from_json(extraction)
if not graph.number_of_nodes():
    raise SystemExit("Graphify extracted an empty graph")
communities = cluster(graph)
labels = {}
for cid, members in communities.items():
    files = Counter(Path(graph.nodes[node].get("source_file") or "external").stem for node in members)
    dominant = files.most_common(1)[0][0]
    labels[cid] = {
        "App": "Inventory User Interface", "CPanel": "Business Administration",
        "api": "Authenticated API", "auth": "Session Authentication",
        "store": "Firestore Transaction Store", "pending-transactions": "Durable Submission Queue",
        "useTransactionSync": "Foreground Transaction Sync", "project-context": "Architecture And Decisions",
        "login-api.test": "API Regression Coverage", "store-policy.test": "Ledger Policy Coverage",
        "pending-transactions.test": "Queue Recovery Coverage", "build-context": "Project Context Generation",
    }.get(dominant, dominant.replace("-", " ").replace("_", " ").title())

detection = {"total_files": len(code) + len(documents), "total_words": words}
report = generate(graph, communities, score_all(graph, communities), labels, god_nodes(graph),
                  surprising_connections(graph, communities), detection,
                  {"input": 0, "output": 0}, "SpiceSentry source context",
                  suggested_questions=suggest_questions(graph, communities, labels))
report = report.replace("- Token cost: 0 input · 0 output", "- External model API tokens: 0. Curated semantic facts use the host agent; host token usage is unavailable.")
report += "\n\n## Refresh and scope\n\nGenerated with graphifyy " + VERSION + ". Run `npm run context:refresh` and `npm run context:check`. Source hashes are in `sources.json`. Business records, credentials, backups, and the credential-bearing WhatsApp script are excluded. This graph does not establish live deployment or reset completion.\n"
# No Obsidian export was requested; remove dead wiki navigation links from the report.
lines = report.splitlines()
report = "\n".join(line for line in lines if not line.startswith("- [[_COMMUNITY_") and line != "## Community Hubs (Navigation)") + "\n"
(OUT / "GRAPH_REPORT.md").write_text(report)
to_json(graph, communities, "graphify-out/graph.json", force=True)
to_html(graph, communities, "graphify-out/graph.html", community_labels=labels, node_limit=5000)
manifest = {
    "graphify_version": VERSION,
    "mode": "local AST plus reviewed semantic context; no external model API",
    "sources": hashes,
    "artifacts": {name: digest(OUT / name) for name in ("graph.json", "GRAPH_REPORT.md", "graph.html")},
}
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
# Machine paths are useful to the CLI but deliberately ignored by Git.
(OUT / ".graphify_python").write_text(sys.executable)
(OUT / ".graphify_root").write_text(str(ROOT))
(OUT / ".graphify_labels.json").write_text(json.dumps(labels))
print(f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, {len(communities)} communities.")
