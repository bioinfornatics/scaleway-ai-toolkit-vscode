"""Run synthetic loopback tests; --record writes sanitized evidence, no cloud calls."""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import platform
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests/hosting'))
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    print(output.getvalue(), file=sys.stderr, end='')
    paths = ['tests/hosting/local_probe.py', 'tests/hosting/test_local_hosting.py',
             'tooling/validate_hosting.py', 'evidence/documentation/hosting-sources-v1.json',
             'specifications/providers/scaleway/hosting.md']
    record = {
        'record_id': 'hosting-local-v1', 'issue': 'scaleway_ai_vscode-jgh.1.6.1',
        'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'method': 'Real loopback HTTP against test-only synthetic stdlib probe',
        'approval': 'Current request: docs/local tests; commit allowed, no push',
        'command': 'python3 tooling/validate_hosting.py --record',
        'status': 'passed' if result.wasSuccessful() else 'failed',
        'tests_run': result.testsRun, 'failures': len(result.failures),
        'errors': len(result.errors), 'skipped': len(result.skipped),
        'environment': {'python': platform.python_version(), 'os': platform.system(),
                        'machine': platform.machine(), 'third_party_dependencies': []},
        'input_sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths},
        'local_profile': {'bind': '127.0.0.1:OS-assigned', 'stream_duration_seconds': [0.3, 0.4, 1, 2],
                          'heartbeat_seconds': 0.025, 'max_active_streams_tested': 2,
                          'stream_io_timeout_seconds': 0.5, 'session_store': 'shared in-process fake'},
        'not_run': ['Scaleway ingress SSE buffering/idle cutoff/header forwarding',
                    '10s/60min cloud timeout boundaries and scale-to-zero',
                    '80-request capacity or multi-replica global budget enforcement',
                    'TLS/IAM/tenant issuer/provider secret broker',
                    'External durable sessions/ledger/crash recovery/retention',
                    'Strands full Agent loop, image build/size/RSS/cold start',
                    'Public/private inference/store egress, cancellation/billing reconciliation',
                    'Cloud provisioning/deletion/cleanup'],
        'provider_requests': 0, 'cloud_resources_created': 0,
        'limitations': 'Synthetic probe, not runtime v1 or production security acceptance.'
    }
    if args.record:
        (ROOT / 'evidence/validation/hosting-local-v1.json').write_text(json.dumps(record, indent=2) + chr(10))
    print(json.dumps({'status': record['status'], 'tests_run': result.testsRun, 'skipped': len(result.skipped)}))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
