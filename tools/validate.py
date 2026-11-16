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
    assert item['kind'] in ('script', 'plugin', 'controller-profile', 'training-plugin')
    assert item['manifestPath'] == f"packages/{item['id']}/{item['version']}/pack.json"
    path = root / item['manifestPath']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['manifestSha256']
    manifest = json.loads(path.read_text(encoding='utf-8'))
    assert manifest['schemaVersion'] == manifest['apiVersion'] and manifest['schemaVersion'] in (1, 2)
    assert item.get('nativeCode', False) == ('runtime' in manifest)
    for key in ('id', 'version', 'name', 'license'):
        assert item[key] == manifest[key], key
    assert item.get('gameId', '') == manifest.get('gameId', '')
    assert (item['kind'] == 'training-plugin') == (manifest.get('trainingAdapter', 'none') != 'none')
    if item['kind'] == 'training-plugin':
        assert manifest['gameId'] and not manifest['bindings']
    assert len(manifest['assets']) <= 40
    if 'controllerTrainer' in manifest:
        trainer = manifest['controllerTrainer']
        assert manifest.get('gameId') and manifest.get('trainingAdapter', 'none') == 'none'
        assert 1 <= len(trainer['shots']) <= 8
        assert len({shot['id'] for shot in trainer['shots']}) == len(trainer['shots'])
        for group in ('timingFeedback', 'tempoFeedback'):
            choices = trainer[group]
            assert 1 <= len(choices) <= 16 and len({choice['id'] for choice in choices}) == len(choices)
            assert all(isinstance(choice['adjustmentMs'], int) and abs(choice['adjustmentMs']) <= 100 for choice in choices)
            assert any(choice['id'] == 'none' and choice['adjustmentMs'] == 0 for choice in choices)
        assert path.read_bytes() == (root / 'plugins/controller-trainer/pack.json').read_bytes()
    for asset in manifest['assets']:
        parts = Path(asset['path']).parts
        assert not Path(asset['path']).is_absolute() and '..' not in parts and ':' not in asset['path']
        assert asset['kind'] in ('lua', 'model', 'visionManifest', 'runtime', 'ui', 'workflow', 'captureModel', 'data')
        if manifest['schemaVersion'] == 1: assert asset['kind'] in ('lua', 'model', 'visionManifest')
        resource = path.parent / asset['path']
        assert resource.resolve().is_relative_to(path.parent.resolve()) and not resource.is_symlink()
        data = resource.read_bytes()
        assert len(data) == asset['bytes']
        assert hashlib.sha256(data).hexdigest() == asset['sha256']
    if 'runtime' in manifest:
        runtime = manifest['runtime']
        assert runtime['contractVersion'] in (1, 2, 3)
        declared = {a['path']: a['kind'] for a in manifest['assets']}
        for key, kind in [('assembly','runtime'), ('uiEntry','ui'), ('trainingEntry','workflow'), ('auditEntry','workflow'), ('experimentsEntry','workflow')]:
            assert declared[runtime[key]] == kind
        assert runtime['modelDirectory'] == 'capture-models'
        provenance = json.loads((path.parent / 'data/source.json').read_text())
        for name, digest in provenance['sources'].items():
            source = (root / name).resolve()
            assert source.is_relative_to(root / 'plugins')
            assert hashlib.sha256(source.read_bytes().replace(b'\r\n', b'\n')).hexdigest() == digest, name
        ui_files = [path.parent / a['path'] for a in manifest['assets'] if a['kind'] == 'ui']
        for file in ui_files:
            text = file.read_text(encoding='utf-8')
            assert not re.search(r"from\s+['\"]react(?:/|['\"])", text), file
        files = {str(f.relative_to(path.parent)).replace('\\','/') for f in path.parent.rglob('*') if f.is_file()}
        assert files == set(declared) | {'pack.json'}, 'Unlisted package resources'
print(f"SUCCESS: {len(seen)} versioned marketplace packages and source hashes validated.")
