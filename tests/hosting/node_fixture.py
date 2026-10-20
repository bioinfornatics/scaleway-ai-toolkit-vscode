"""Synthetic test fixture, bootstrap over fd3 only, no secret stdout/env/argv.

Never exposed publicly; Python process lifecycle belongs to Node test harness.
"""
import json
import os
import sys
from local_probe import running_probe

with running_probe(duration=0.4) as server:
    with os.fdopen(3, 'w') as pipe:
        pipe.write(json.dumps({'origin': 'http://' + server.expected_host,
                               'bearer': next(k for k, v in server.tokens.items() if v == 'alice')}) + chr(10))
        pipe.flush()
    sys.stdin.read()
