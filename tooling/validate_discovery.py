"""Offline evidence consistency checks; not production/provider/security validation.

Run: python3 tooling/validate_discovery.py
Only reads repository data. Does not import downloaded sources or use network.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(path):
    return json.loads((ROOT / path).read_text())


def safe_path(path):
    candidate = (ROOT / path).resolve()
    require(candidate.is_relative_to(ROOT), "Path outside repository: " + path)
    require(candidate.is_file(), "Missing file: " + path)
    return candidate


def verify_hash(path, expected):
    require(bool(re.fullmatch(r"[0-9a-f]{64}", expected)), "Invalid hash: " + path)
    require(hashlib.sha256(safe_path(path).read_bytes()).hexdigest() == expected,
            "Hash mismatch: " + path)


def validate():
    parsed = 0
    # Upstream source snapshots are opaque bytes unless explicitly JSON artifacts.
    for path in ROOT.glob("evidence/**/*.json"):
        json.loads(path.read_text())
        parsed += 1
    serverless = load("evidence/documentation/serverless-sources-v1.json")
    snapshots = [r for r in serverless["records"] if r.get("snapshot_path")]
    for record in snapshots:
        verify_hash(record["snapshot_path"], record["snapshot_sha256"])
        require(record.get("url") and record.get("retrieved_at"), "Missing provenance")
    dedicated = load("evidence/schemas/dedicated-provenance.json")
    for record in dedicated["files"]:
        verify_hash(record["file"], record["sha256"])
        require(record.get("commit") in record["url"], "Unpinned dedicated source")
    security = load("evidence/security/threat-model-checks.json")
    threats = {t["id"]: t for t in security["threats"]}
    checks = {c["id"]: c for c in security["checks"]}
    require(len(threats) == len(security["threats"]), "Duplicate threats")
    require(len(checks) == len(security["checks"]), "Duplicate checks")
    coverage = set()
    cases = safe_path(security["documents"]["security_test_cases"]).read_text()
    for threat in threats.values():
        for field in ("boundary", "attack", "mitigation", "residual_risk", "requirements", "check_ids"):
            require(bool(threat.get(field)), "Missing threat field: " + field)
        coverage.update(threat["requirements"])
        for check_id in threat["check_ids"]:
            require(check_id in checks and threat["id"] in checks[check_id]["threat_ids"], "Broken threat reference")
    for check in checks.values():
        for field in ("fixture", "procedure", "assertions", "requirements", "threat_ids"):
            require(bool(check.get(field)), "Missing check field: " + field)
        require(check["execution_status"] == "not_run", "Unsupported runtime test pass")
        require('id="' + check["id"].lower() + '"' in cases, "Missing case anchor")
        for threat_id in check["threat_ids"]:
            require(threat_id in threats and check["id"] in threats[threat_id]["check_ids"], "Broken check reference")
    require(set(security["validator_contract"]["required_requirement_coverage"]) <= coverage, "Requirement coverage missing")
    require(not security["provenance"]["runtime_tests_run"], "Unsupported security execution claim")
    matrix = load("evidence/capabilities/serverless-matrix-v1.json")
    tri = {"supported", "unsupported", "unknown"}
    for value in matrix["endpoint_capabilities"].values():
        require(value["status"] in tri, "Invalid endpoint capability")
    for model in matrix["models"]:
        require(model["serverless_model_id"] is None, "Unverified discovery ID")
        require(model["catalog_availability"]["live_status"] == "unknown", "Unverified live availability")
        for feature in model["features"].values():
            require(feature["status"] in tri, "Invalid model feature")
        require(model["provenance"]["source_revision"], "Missing matrix revision")
    def refs(node, schema):
        if isinstance(node, dict):
            if "$ref" in node:
                reference = node["$ref"]
                require(reference.startswith("#/"), "External schema reference")
                target = schema
                for part in reference[2:].split("/"):
                    target = target[part.replace("~1", "/").replace("~0", "~")]
            for value in node.values():
                refs(value, schema)
        elif isinstance(node, list):
            for value in node:
                refs(value, schema)
    for filename in ("dedicated", "projects"):
        schema = load("evidence/schemas/" + filename + "-response-shapes.schema.json")
        refs(schema, schema)
    documents = ["specifications/providers/scaleway/serverless.md", "specifications/providers/scaleway/dedicated.md",
                 "specifications/validation/developer-scenario.md", *security["documents"].values()]
    for filename in documents:
        path = safe_path(filename)
        for link in re.findall(r"\]\(([^)]+)\)", path.read_text()):
            if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", link):
                target = link.split("#")[0]
                if target:
                    require((path.parent / target).exists(), "Missing document link: " + link)
    return {"status": "passed", "method": "offline_document_consistency_only",
            "json_files": parsed, "source_hashes": len(snapshots) + len(dedicated["files"]),
            "security_threats": len(threats), "future_security_cases": len(checks), "catalog_rows": len(matrix["models"]),
            "not_run": ["production adapter tests", "Strands integration", "runtime security cases", "live provider requests", "developer study", "hosting"]}


if __name__ == "__main__":
    try:
        print(json.dumps(validate(), indent=2))
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
