"""Validate catalog/package identities and exact source hashes without executing scripts."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
assert catalog['schemaVersion'] == 1
seen = set()
for item in catalog['entries']:
    for key in ('id', 'version'):
        assert re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,59}', item[key])
    identity = (item['id'], item['version'])
    assert identity not in seen
    seen.add(identity)
    assert item['kind'] in ('script', 'plugin')
    assert item['manifestPath'] == f"packages/{item['id']}/{item['version']}/pack.json"
    path = root / item['manifestPath']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['manifestSha256']
    manifest = json.loads(path.read_text(encoding='utf-8'))
    assert manifest['schemaVersion'] == manifest['apiVersion'] == 1
    for key in ('id', 'version', 'name', 'license'):
        assert item[key] == manifest[key], key
    assert len(manifest['assets']) <= 40
    for asset in manifest['assets']:
        parts = Path(asset['path']).parts
        assert not Path(asset['path']).is_absolute() and '..' not in parts and ':' not in asset['path']
        assert asset['kind'] in ('lua', 'model', 'visionManifest')
        resource = path.parent / asset['path']
        assert resource.resolve().is_relative_to(path.parent.resolve()) and not resource.is_symlink()
        data = resource.read_bytes()
        assert len(data) == asset['bytes']
        assert hashlib.sha256(data).hexdigest() == asset['sha256']
print(f"SUCCESS: {len(seen)} versioned marketplace packages and source hashes validated.")
