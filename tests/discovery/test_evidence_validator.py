"""Tests our evidence validator, not downloaded SDK code or cloud services."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("evidence_validator", ROOT / "tooling/validate_discovery.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class EvidenceValidatorTests(unittest.TestCase):
    def test_current_evidence_is_consistent(self):
        result = validator.validate()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["security_threats"], 26)
        self.assertIn("runtime security cases", result["not_run"])

    def test_corrupt_snapshot_hash_fails(self):
        with self.assertRaisesRegex(ValueError, "Hash mismatch"):
            validator.verify_hash("evidence/security/threat-model-checks.json", "0" * 64)

    def test_external_path_fails(self):
        with self.assertRaisesRegex(ValueError, "outside repository"):
            validator.safe_path("../../outside.invalid")

    def test_invented_live_capability_fails(self):
        original = validator.load
        def modified(path):
            data = original(path)
            if path == "evidence/capabilities/serverless-matrix-v1.json":
                data["models"][0]["catalog_availability"]["live_status"] = "supported"
            return data
        with patch.object(validator, "load", side_effect=modified):
            with self.assertRaisesRegex(ValueError, "Unverified live availability"):
                validator.validate()

    def test_invented_runtime_security_pass_fails(self):
        original = validator.load
        def modified(path):
            data = original(path)
            if path == "evidence/security/threat-model-checks.json":
                data["checks"][0]["execution_status"] = "passed"
            return data
        with patch.object(validator, "load", side_effect=modified):
            with self.assertRaisesRegex(ValueError, "Unsupported runtime test pass"):
                validator.validate()

    def test_dangling_threat_reference_fails(self):
        original = validator.load
        def modified(path):
            data = original(path)
            if path == "evidence/security/threat-model-checks.json":
                data["threats"][0]["check_ids"] = ["missing"]
            return data
        with patch.object(validator, "load", side_effect=modified):
            with self.assertRaisesRegex(ValueError, "Broken threat reference"):
                validator.validate()
