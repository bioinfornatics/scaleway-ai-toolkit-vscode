"""Verify final VSIX bytes and isolated CommonJS loading; never activate it.
Usage: python3 verifyVsix.py archive.vsix [--root extension-checkout]
The checked-in host minimum is declared, not validated by this Node smoke check.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

MAX_ARCHIVE = 64 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024


def safe_name(name):
    parts = name.rstrip('/').split('/')
    if (not name or len(name) > 512 or len(parts) > 24 or
            any(p in ('', '.', '..') or ':' in p for p in parts) or
            '\\' in name or any(ord(c) < 32 for c in name)):
        raise ValueError('Unsafe ZIP path: ' + repr(name))
    return PurePosixPath(*parts).as_posix()


def expected_tree(root):
    expected = {}
    for folder in ('dist', 'media', 'assets'):
        base = root / folder
        if not base.is_dir() or base.is_symlink():
            raise ValueError('Missing/unsafe expected tree: ' + folder)
        for directory, dirs, files in os.walk(base, followlinks=False):
            for name in dirs + files:
                p = Path(directory) / name
                info = p.lstat()
                if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    raise ValueError('Unsafe expected file')
                if stat.S_ISREG(info.st_mode):
                    if info.st_nlink != 1 or info.st_size > MAX_FILE:
                        raise ValueError('Unsafe expected file size/link')
                    expected['extension/' + p.relative_to(root).as_posix()] = p.read_bytes()
                    if len(expected) > 4096 or sum(map(len, expected.values())) > MAX_TOTAL:
                        raise ValueError('Expected tree budget exceeded')
    expected['extension/package.json'] = (root / 'package.json').read_bytes()
    license_file = root / 'LICENSE'
    if license_file.is_symlink() or not license_file.is_file() or license_file.stat().st_size > MAX_FILE:
        raise ValueError('Missing/unsafe LICENSE')
    # vsce canonicalizes these two source filenames; compare their exact bytes.
    expected['extension/LICENSE.txt'] = license_file.read_bytes()
    if not expected['extension/LICENSE.txt']:
        raise ValueError('Empty LICENSE')
    for source, shipped in (('README.md', 'readme.md'),
                            ('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md')):
        source_file = root / source
        if source_file.is_symlink() or not source_file.is_file() or source_file.stat().st_size > MAX_FILE:
            raise ValueError('Missing/unsafe ' + source)
        expected['extension/' + shipped] = source_file.read_bytes()
    return expected


LOAD_PROBE = r"""
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const root = fs.realpathSync(process.argv[1]);
const original = Module._load;
const builtin = new Set(Module.builtinModules.map(x => x.replace(/^node:/, '')));
const allowed = new Set(['fs','fs/promises','http','https','net','tls','dns','path','url','util','events','stream','buffer','crypto','os','assert','string_decoder','querystring','zlib','tty','punycode']);
const fail = () => { throw new Error('Side effect forbidden during VSIX load'); };
// Read-only probe: permit fs reads, never writing, activation, process or network.
for (const key of Object.keys(fs)) if (/^(write|append|truncate|unlink|rm|rmdir|mkdir|rename|copy|cp|chmod|chown|link|symlink|createWrite|watch)/.test(key)) fs[key] = fail;
for (const key of Object.keys(fs.promises)) if (!/^(read|stat|lstat|realpath|access|readdir|readlink)$/.test(key)) fs.promises[key] = fail;
fs.open = fs.openSync = fail;
for (const name of ['http','https','net','tls','dns']) {
 const api = require('node:' + name);
 for (const key of ['request','get','connect','createConnection','createServer','lookup','resolve']) if (typeof api[key] === 'function') api[key] = fail;
 if (api.Socket) { api.Socket.prototype.connect = fail; api.Socket.prototype.write = fail; }
}
global.fetch = fail;
global.setTimeout = global.setInterval = global.setImmediate = fail;
class Disposable { dispose() {} }
const vscode = { Disposable, EventEmitter: class { event() { return new Disposable(); } fire() {} dispose() {} },
  TreeItem: class {}, ThemeIcon: class {}, Uri: { file: p => ({ fsPath:p }), parse: p => ({toString:()=>p}) },
  TreeItemCollapsibleState: { None:0, Collapsed:1, Expanded:2 } };
Module._load = function(request, parent, main) {
  if (request === 'vscode') return vscode;
  if (builtin.has(request.replace(/^node:/,''))) {
    if (!allowed.has(request.replace(/^node:/,''))) throw new Error('Forbidden builtin: ' + request);
    return original.call(this, request, parent, main);
  }
  const resolved = Module._resolveFilename(request, parent, main);
  if (!fs.realpathSync(resolved).startsWith(root + path.sep)) throw new Error('Dependency outside extracted VSIX: ' + request);
  return original.call(this, request, parent, main);
};
const manifest = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const entry = require(path.resolve(root,manifest.main));
if (typeof entry.activate !== 'function') throw new Error('Missing activate export');
function visit(dir) { for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
 const p=path.join(dir,item.name); if(item.isDirectory()) visit(p); else if(p.endsWith('.js')) require(p);
} }
visit(path.join(root,'dist'));
console.log(JSON.stringify({ load:'PASS', activation:'NOT RUN', network:'FORBIDDEN' }));
"""


def verify(archive, root):
    info = archive.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARCHIVE:
        raise ValueError('Unsafe archive or archive size limit')
    expected = expected_tree(root)
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > 4096:
            raise ValueError('ZIP entry limit')
        seen, total, payload = set(), 0, {}
        for entry in entries:
            name = safe_name(entry.filename)
            key = name.casefold()
            if key in seen:
                raise ValueError('Duplicate ZIP path')
            seen.add(key)
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                raise ValueError('ZIP symlink/special/encrypted entry')
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Unsupported ZIP compression')
            total += entry.file_size
            if entry.file_size > MAX_FILE or total > MAX_TOTAL or entry.file_size > max(1024 * 1024, entry.compress_size * 200):
                raise ValueError('ZIP expansion budget')
            if entry.is_dir():
                continue
            if name not in ('[Content_Types].xml', 'extension.vsixmanifest') and not name.startswith('extension/'):
                raise ValueError('Unexpected ZIP root')
            if name.startswith('extension/'):
                rel = name.split('/')[1:]
                if 'node_modules' in rel or rel[0] in ('src','tests') or name.endswith(('.vsix','.ts','.map','.mjs')) and rel[0] != 'assets':
                    raise ValueError('Source/dependency/build tooling shipped')
                if rel[0] not in ('dist','media','assets') and '/'.join(rel) not in ('package.json','readme.md','LICENSE.txt','THIRD_PARTY_NOTICES.md'):
                    raise ValueError('Unexpected extension payload: ' + name)
            payload[name] = z.read(entry)  # CRC validated, prebounded sizes.
        for name, content in expected.items():
            if payload.get(name) != content:
                raise ValueError('Missing or mutated payload: ' + name)
        for name in payload:
            if name.startswith('extension/') and name not in expected:
                raise ValueError('Unexpected generated/media/asset payload')
        if not payload.get('extension.vsixmanifest') or not payload.get('[Content_Types].xml'):
            raise ValueError('Missing VSIX manifest/content types')
        manifest = json.loads(payload['extension/package.json'])
        if manifest.get('license') != 'CeCILL-2.1':
            raise ValueError('Expected CeCILL-2.1 license metadata')
        identity = ET.fromstring(payload['extension.vsixmanifest']).find('.//{*}Identity')
        if identity is None or any(identity.get(xml) != manifest.get(key) for xml, key in
                                   (('Id', 'name'), ('Version', 'version'), ('Publisher', 'publisher'))):
            raise ValueError('VSIX identity/version/publisher mismatch')
        main = manifest.get('main', '')
        main = main[2:] if main.startswith('./') else main
        if not main.startswith('dist/') or safe_name(main) != main or 'extension/' + main not in payload:
            raise ValueError('Missing/unsafe extension entry')
        with tempfile.TemporaryDirectory(prefix='scw-vsix-verify-', dir='/tmp') as temp:
            destination = Path(temp)
            for name, data in payload.items():
                p = destination / name
                p.parent.mkdir(parents=True, exist_ok=True)
                with p.open('xb') as f:
                    f.write(data)
            node = shutil.which('node')
            if not node:
                raise ValueError('Node required for isolated dependency load')
            result = subprocess.run([node, '--no-addons', '--no-global-search-paths', '-e', LOAD_PROBE, str(destination / 'extension')],
                                    cwd=temp, env={'PATH': os.environ.get('PATH', ''), 'HOME': temp},
                                    text=True, capture_output=True, timeout=30)
            if result.returncode:
                raise ValueError('Isolated dependency load failed: ' + result.stderr[:2000])
    return {'verification': 'PASS', 'entries': len(entries), 'bytes': total,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'activation': 'NOT RUN', 'minimumHostValidation': 'UNKNOWN',
            'license': manifest['license'], 'version': manifest.get('version'),
            'publisher': manifest.get('publisher'),
            'declaredEngines': manifest.get('engines')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.archive.absolute(), args.root.absolute())))
    except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError, subprocess.TimeoutExpired) as error:
        parser.exit(1, 'VSIX verification FAILED: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
