"""Offline release metadata gate; no tag creation or publication."""
import json
from pathlib import Path
import re
import sys


def validate(tag, root):
    manifest = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    if not re.fullmatch(r'v0.0.[0-9]+', tag) or tag != 'v' + manifest['version']:
        raise ValueError('Release tag must exactly match current preview version')
    if manifest.get('publisher') != 'scaleway-ai-community-preview' or manifest.get('name') != 'scaleway-ai-toolkit-preview':
        raise ValueError('Unexpected extension identity/publisher')
    if manifest.get('private') is not True or manifest.get('license') != 'CeCILL-2.1':
        raise ValueError('Private npm package and CeCILL-2.1 required')
    if manifest.get('repository', {}).get('url') != 'https://github.com/bioinfornatics/scaleway-ai-toolkit-vscode.git':
        raise ValueError('Unexpected repository owner')
    if lock.get('version') != manifest['version'] or lock['packages']['']['version'] != manifest['version'] or lock['packages'][''].get('license') != manifest['license']:
        raise ValueError('Lock metadata mismatch')
    if not (root / 'LICENSE').read_bytes() or (root / 'LICENSE').read_bytes() != (root.parents[1] / 'LICENSE').read_bytes():
        raise ValueError('Repository and extension LICENSE bytes must match')
    return {'tag': tag, 'version': manifest['version'], 'publisher': manifest['publisher'], 'publication': 'NOT RUN'}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: releaseGate.py v0.0.37')
        print(json.dumps(validate(sys.argv[1], Path(__file__).resolve().parents[1])))
    except (ValueError, OSError, KeyError) as error:
        sys.exit('Release gate FAILED: ' + str(error))
