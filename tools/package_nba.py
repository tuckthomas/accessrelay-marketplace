"""Build the unified NBA 2K27 add-on package (vision, custom UI, training, and Lua shot trainer)."""
import argparse, hashlib, json, os, subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugins/nba2k27'
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=Path(os.environ.get('ACCESSRELAY_SDK_ROOT', ROOT.parent / 'AccessRelayStudio-Source')))
parser.add_argument('--model-cache', type=Path)
parser.add_argument('--skip-build', action='store_true')
parser.add_argument('--runtime', type=Path, help='Use a runtime from an isolated build when --skip-build is selected.')
args = parser.parse_args()
sdk = args.sdk.resolve()
version = json.loads((PLUGIN / 'package.json').read_text())['version']
published = subprocess.run(['git', 'cat-file', '-e', f'HEAD:packages/nba2k27/{version}/pack.json'], cwd=ROOT, capture_output=True)
if published.returncode == 0:
    raise SystemExit('This version is already committed. Increment the plugin version before packaging a change.')
environment = dict(os.environ, ACCESSRELAY_SDK_ROOT=str(sdk))
if not args.skip_build:
    subprocess.run(['dotnet', 'build', str(PLUGIN / 'accessrelay.nba2k27.csproj'), '-c', 'Release', '--nologo', '-v', 'minimal', f'-p:HostSdkRoot={sdk}'], check=True, env=environment)
    subprocess.run(['node', str(PLUGIN / 'build-ui.mjs')], check=True, env=environment)
target = ROOT / 'packages/nba2k27' / version
assert target.resolve().is_relative_to(ROOT / 'packages')
target.mkdir(parents=True, exist_ok=True)
assets: list[dict[str, Any]] = []
total_bytes = 0
def add(source: Path, relative: str, kind: str) -> dict[str, Any]:
    global total_bytes
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    if kind not in ('runtime', 'captureModel', 'model') and destination.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        data = data.replace(b'\r\n', b'\n')
    if not destination.exists() or destination.read_bytes() != data:
        destination.write_bytes(data)
    entry: dict[str, Any] = dict(path=relative, kind=kind, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    assets.append(entry)
    total_bytes += len(data)
    return entry

if args.runtime and not args.skip_build:
    raise SystemExit('--runtime requires --skip-build.')
add(args.runtime or PLUGIN / 'bin/Release/net10.0/accessrelay.nba2k27.dll', 'runtime/accessrelay.nba2k27.dll', 'runtime')
for file in sorted((PLUGIN / 'dist/ui').glob('*.js')): add(file, 'ui/' + file.name, 'ui')
for file in sorted((PLUGIN / 'training').glob('*.py')): add(file, 'training/' + file.name, 'workflow')
for file in sorted((PLUGIN / 'notices').glob('*')): add(file, 'data/' + file.name, 'data')
cover_source = next((p for p in [PLUGIN / 'cover.jpg', PLUGIN / 'cover.jpeg', PLUGIN / 'cover.png', PLUGIN / 'cover.webp'] if p.is_file()), None)
cover_entry = add(cover_source, 'data/cover' + cover_source.suffix.lower(), 'data') if cover_source else None
cache = (args.model_cache or sdk / 'artifacts/AutoCaptureModels').resolve()
legacy_cache = ROOT / 'packages/nba2k27/2.1.0/capture-models'
expected = {
    'pose.onnx': '20aad6e2e42359cac1c5b4a0b2da00e29bfe91a72a782fdcf287d273a04c1b24',
    'text-det.onnx': 'ea07c15d38ac40cd69da3c493444ec75b44ff23840553ff8ba102c1219ed39c2',
    'text-rec.onnx': 'e8770c967605983d1570cdf5352041dfb68fa0c21664f49f47b155abd3e0e318'
}
for name, digest in expected.items():
    source = cache / name
    if not source.exists(): source = target / 'capture-models' / name
    if not source.exists(): source = legacy_cache / name
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, f'Capture model hash mismatch: {source}'
    add(source, 'capture-models/' + name, 'captureModel')
sources = sorted([* (PLUGIN / 'src').glob('*.cs'), * (PLUGIN / 'ui').glob('*.ts'), * (PLUGIN / 'ui').glob('*.tsx'), * (PLUGIN / 'training').glob('*.py')])
provenance = target / 'data/source.json'
provenance.write_text(json.dumps(dict(plugin='plugins/nba2k27', contractVersion=5,
    sources={str(file.relative_to(ROOT)).replace('\\','/'): hashlib.sha256(file.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for file in sources}), indent=2) + '\n', encoding='utf-8', newline='\n')
add(provenance, 'data/source.json', 'data')
controller_trainer = json.loads((PLUGIN / 'controller-trainer.json').read_text(encoding='utf-8'))
manifest = dict(
    schemaVersion=2, apiVersion=2, id='nba2k27', version=version,
    name='NBA 2K27',
    description='Unified NBA 2K27 add-on: live curved-meter assistance with RHYTHM/TIMING feedback, auto-OCR timing, animation model training, and Lua shot trainer.',
    license='0BSD; capture models Apache-2.0', gameId='nba2k27',
    trainingAdapter='nba2k27-training-v1', visionAdapter='temporal-release-v1',
    runtime=dict(
        assembly='runtime/accessrelay.nba2k27.dll', factory='EliteScriptStudio.Packs.Nba2K27.NbaPluginFactory', uiEntry='ui/index.js',
        trainingEntry='training/Run-NbaTraining.py', modelDirectory='capture-models', contractVersion=5,
        auditEntry='training/Audit-VisionDataset.py', experimentsEntry='training/Run-VisionExperiments.py'
    ),
    controllerTrainer=controller_trainer,
    assets=assets, bindings=[], tuning=[], presets=[]
)
manifest_file = target / 'pack.json'
manifest_file.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
catalog_file = ROOT / 'catalog.json'
catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
catalog_entry: dict[str, Any] = dict(
    id=manifest['id'], name=manifest['name'], description=manifest['description'],
    author='AccessRelay', version=version, kind='training-plugin', gameId='nba2k27',
    license=manifest['license'], manifestPath=str(manifest_file.relative_to(ROOT)).replace('\\', '/'),
    manifestSha256=hashlib.sha256(manifest_file.read_bytes()).hexdigest(),
    tags=['nba2k27', 'vision', 'training', 'shot-trainer', 'lua'], nativeCode=True
)
if cover_entry is not None:
    catalog_entry['coverPath'] = f"packages/{manifest['id']}/{version}/{cover_entry['path']}"
    catalog_entry['coverSha256'] = cover_entry['sha256']
catalog['entries'] = [catalog_entry]
catalog_file.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8', newline='\n')
print(f'SUCCESS {manifest["id"]}@{version}: {len(assets)} checked implementation assets, {total_bytes/1024**2:.1f} MiB.')
