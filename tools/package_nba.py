"""Build a complete NBA implementation package; no application sources are copied into it."""
import argparse, hashlib, json, os, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugins/nba2k27'
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=Path(os.environ.get('ACCESSRELAY_SDK_ROOT', ROOT.parent / 'AccessRelayStudio-Source')))
parser.add_argument('--model-cache', type=Path)
parser.add_argument('--skip-build', action='store_true')
args = parser.parse_args()
sdk = args.sdk.resolve()
version = json.loads((PLUGIN / 'package.json').read_text())['version']
published = subprocess.run(['git', 'cat-file', '-e', f'HEAD:packages/nba2k27-training/{version}/pack.json'], cwd=ROOT, capture_output=True)
if published.returncode == 0:
    raise SystemExit('This version is already committed. Increment the plugin version before packaging a change.')
environment = dict(os.environ, ACCESSRELAY_SDK_ROOT=str(sdk))
if not args.skip_build:
    subprocess.run(['dotnet', 'build', str(PLUGIN / 'accessrelay.nba2k27.csproj'), '-c', 'Release', '--nologo', '-v', 'minimal', f'-p:HostSdkRoot={sdk}'], check=True, env=environment)
    subprocess.run(['pnpm.cmd' if os.name == 'nt' else 'pnpm', '--dir', str(PLUGIN), 'build'], check=True, env=environment)
target = ROOT / 'packages/nba2k27-training' / version
assert target.resolve().is_relative_to(ROOT / 'packages')
target.mkdir(parents=True, exist_ok=True)
assets = []
def add(source, relative, kind):
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    if kind not in ('runtime', 'captureModel', 'model'): data = data.replace(b'\r\n', b'\n')
    if not destination.exists() or destination.read_bytes() != data: destination.write_bytes(data)
    assets.append(dict(path=relative, kind=kind, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))

add(PLUGIN / 'bin/Release/net10.0/accessrelay.nba2k27.dll', 'runtime/accessrelay.nba2k27.dll', 'runtime')
for file in sorted((PLUGIN / 'dist/ui').glob('*.js')): add(file, 'ui/' + file.name, 'ui')
for file in sorted((PLUGIN / 'training').glob('*.py')): add(file, 'training/' + file.name, 'workflow')
for file in sorted((PLUGIN / 'notices').glob('*')): add(file, 'data/' + file.name, 'data')
cache = (args.model_cache or sdk / 'artifacts/AutoCaptureModels').resolve()
expected = {
    'pose.onnx': '20aad6e2e42359cac1c5b4a0b2da00e29bfe91a72a782fdcf287d273a04c1b24',
    'text-det.onnx': 'ea07c15d38ac40cd69da3c493444ec75b44ff23840553ff8ba102c1219ed39c2',
    'text-rec.onnx': 'e8770c967605983d1570cdf5352041dfb68fa0c21664f49f47b155abd3e0e318'
}
for name, digest in expected.items():
    source = cache / name
    if not source.exists(): source = target / 'capture-models' / name
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, f'Capture model hash mismatch: {source}'
    add(source, 'capture-models/' + name, 'captureModel')
sources = sorted([* (PLUGIN / 'src').glob('*.cs'), * (PLUGIN / 'ui').glob('*.ts'), * (PLUGIN / 'ui').glob('*.tsx'), * (PLUGIN / 'training').glob('*.py')])
provenance = target / 'data/source.json'
provenance.write_text(json.dumps(dict(plugin='plugins/nba2k27', contractVersion=1,
    sources={str(file.relative_to(ROOT)).replace('\\','/'): hashlib.sha256(file.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for file in sources}), indent=2) + '\n', encoding='utf-8')
add(provenance, 'data/source.json', 'data')
manifest = dict(schemaVersion=2, apiVersion=2, id='nba2k27-training', version=version,
    name='NBA 2K27 Model Training', description='NBA 2K27 profiles, automatic player/meter/court regions, clip review and offline model training. Includes pose/OCR capture models; the shot-release model requires your training footage.',
    license='0BSD; capture models Apache-2.0', gameId='nba2k27', trainingAdapter='nba2k27-training-v1', visionAdapter='temporal-release-v1',
    runtime=dict(assembly='runtime/accessrelay.nba2k27.dll', factory='EliteScriptStudio.Packs.Nba2K27.NbaPluginFactory', uiEntry='ui/index.js',
        trainingEntry='training/Run-NbaTraining.py', modelDirectory='capture-models', contractVersion=1,
        auditEntry='training/Audit-VisionDataset.py', experimentsEntry='training/Run-VisionExperiments.py'),
    assets=assets, bindings=[], tuning=[], presets=[])
manifest_file = target / 'pack.json'
manifest_file.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
catalog_file = ROOT / 'catalog.json'
catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
entry = next(item for item in catalog['entries'] if item['id'] == manifest['id'])
entry.update({key: manifest[key] for key in ('name','description','version','license','gameId')})
entry.update(manifestPath=str(manifest_file.relative_to(ROOT)).replace('\\','/'),
    manifestSha256=hashlib.sha256(manifest_file.read_bytes()).hexdigest(), nativeCode=True)
catalog_file.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
print(f'SUCCESS {manifest["id"]}@{version}: {len(assets)} checked implementation assets, {sum(a["bytes"] for a in assets)/1024**2:.1f} MiB.')
