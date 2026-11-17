# AccessRelay Marketplace

This repository owns scripts, controller profiles and game/training implementations.
Studio's generic engine, plugin host and shared UI live in
[accessrelay-studio](https://github.com/tuckthomas/accessrelay-studio).

Open Marketplace in Studio to filter by type/game and install a package. Controller
packages appear in Controller → Plugins. Training plugins become selectable in
Model Training. Installation starts no recording, inference or output.

NBA 2K27 Model Training **1.1.1** is an actual implementation: C# runtime, React
interface using Studio's shared components, player/meter/court/HUD rules, profiles,
offline Python workflows and licensed pose/OCR capture models. Source and checks
are in [plugins/nba2k27](plugins/nba2k27). No trained shot-release model is included.
Existing NBA profiles and recordings remain compatible. The Rhythm Script is optional.

Version 1.1.1 binds converted model inputs to reviewed intervals and keeps every
history frame inside its interval. Original footage stays intact. Training can
declare its temporal history, timing-loss scale and annotation uncertainty floor;
initial timing bias uses training labels only. See
[the first real-footage candidate report](docs/nba2k27-first-candidate.md).

Schema/API 1 uses sandboxed Lua/declarative tuning. Schema/API 2 loads .NET, UI and
workflow code with the user's permissions; it is trusted code, not a sandbox.
Listings declare nativeCode: true. Review source before installing. Every asset
has a checked path, size and SHA-256. Older enabling-only manifests remain in history;
new Studio versions require an actual implementation package.

To build with a sibling AccessRelayStudio-Source SDK checkout:

    pnpm --dir ../AccessRelayStudio-Source/src/AccessRelayStudio/DesktopUi install --frozen-lockfile
    pnpm install --frozen-lockfile
    dotnet build plugins/nba2k27/accessrelay.nba2k27.csproj -c Release
    pnpm --dir plugins/nba2k27 build
    python tools/validate.py

Use ACCESSRELAY_SDK_ROOT for UI/tests and -p:HostSdkRoot=<path> for .NET with a
custom checkout path. The optional tools/Install-NbaCaptureModels.ps1 populates a
development cache from pinned upstream URLs; Studio does not run it.

Contributions add packages/<id>/<version>/pack.json, declared resources, source,
licenses and a catalog entry with the exact manifest SHA-256. Published versions
are immutable: use a new version for changes. tools/validate.py checks identities,
resource hashes and implementation source provenance without executing the package.
Earlier sample packages remain unlisted.

To publish a change, increment the plugin version, then run tools/package_nba.py
with --model-cache pointing to a verified capture-model directory. The packager
refuses to rewrite a version already committed to Git.

Source-only development branches can validate the existing published catalog with
`python tools/validate.py --catalog-only`. This still verifies every manifest and
asset hash. The default command also compares package provenance with current
plugin sources and is required after building a new package. Historical packages
are not rewritten to match unpublished development changes.
