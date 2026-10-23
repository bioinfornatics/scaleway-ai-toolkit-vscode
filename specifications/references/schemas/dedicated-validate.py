"""Offline validation; never calls provider APIs or loads credentials."""
from pathlib import Path
import json, hashlib, re, datetime, subprocess
ROOT = Path(__file__).resolve().parents[3]
manifest = json.loads((ROOT/"specifications/references/schemas/dedicated-provenance.json").read_text())
for item in manifest["files"]:
    assert hashlib.sha256((ROOT/item["file"]).read_bytes()).hexdigest() == item["sha256"], item["file"]
artifacts = ["specifications/references/schemas/dedicated-extract.py", "specifications/references/schemas/dedicated-response-shapes.schema.json", "specifications/references/schemas/projects-response-shapes.schema.json", "specifications/references/schemas/dedicated-read-operations.source-derived.json"]
before = {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in artifacts}
subprocess.run(["python3",str(ROOT/"specifications/references/schemas/dedicated-extract.py")],check=True)
assert before == {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in artifacts}
for p in artifacts[1:]: json.loads((ROOT/p).read_text())
def check_refs(node, defs):
    if isinstance(node, dict):
        if "$ref" in node: assert node["$ref"].split("/")[-1] in defs
        for value in node.values(): check_refs(value, defs)
    if isinstance(node, list):
        for value in node: check_refs(value, defs)
for prefix in ["dedicated","projects"]:
    schema = json.loads((ROOT/("specifications/references/schemas/"+prefix+"-response-shapes.schema.json")).read_text())
    check_refs(schema,schema["$defs"])
for filename in ["specifications/providers/scaleway/dedicated.md","specifications/references/documentation/dedicated-review.md","specifications/references/documentation/projects-review.md"]:
    f = ROOT/filename
    for link in re.findall(r"\]\(([^)]+)\)",f.read_text()):
        if not link.startswith("http") and link != "dedicated-validation.json": assert (f.parent/link.split("#")[0]).exists(), (filename,link)
record = {"record_id":"dedicated-offline-validation-2026-10-20","verified_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"method":"Offline standard-library source hashes, deterministic extraction, JSON parsing, local schema references and markdown links; NOT provider conformance","task":"scaleway_ai_vscode-jgh.1.3","source_hashes_checked":len(manifest["files"]),"source_hashes":"passed","deterministic_regeneration":"passed","json_parse":"passed","local_schema_references":"passed","local_markdown_links":"passed","derived_artifacts":[{"file":p,"sha256":h} for p,h in before.items()],"commands":["python3 specifications/references/schemas/dedicated-validate.py","python3 specifications/references/schemas/dedicated-extract.py"],"not_run":["authenticated discovery","inference","provisioning","IAM tests","quota or stock observations","private reachability","package installs or builds"]}
(ROOT/"specifications/references/documentation/dedicated-validation.json").write_text(json.dumps(record,indent=2)+"\n")
assert (ROOT/"specifications/references/documentation/dedicated-validation.json").exists()
print(json.dumps({"source_hashes_checked":len(manifest["files"]),"derived_artifacts":len(artifacts),"checks":"passed"}))
