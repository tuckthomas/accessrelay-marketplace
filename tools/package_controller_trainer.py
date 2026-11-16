"""Package the declarative controller trainer without changing published versions."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'plugins/controller-trainer/pack.json'
data = source.read_bytes()
manifest = json.loads(data)
assert manifest['id'] == 'nba2k27' and manifest['controllerTrainer']
assert not manifest['assets'] and not manifest['bindings']
relative = f"packages/{manifest['id']}/{manifest['version']}/pack.json"
target = root / relative
tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', relative], cwd=root, capture_output=True).returncode == 0
if target.exists() and target.read_bytes() != data and tracked:
    raise SystemExit('Published packages are immutable. Increase the source manifest version.')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(data)
catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
entry = next(item for item in catalog['entries'] if item['id'] == manifest['id'])
entry.update(name=manifest['name'], description=manifest['description'], version=manifest['version'],
             kind='controller-profile', manifestPath=relative, manifestSha256=hashlib.sha256(data).hexdigest(),
             tags=['nba2k27', 'controller', 'baseline', 'lua', 'shot-trainer'])
(root / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
print(f"SUCCESS: packaged {manifest['name']} {manifest['version']}.")
