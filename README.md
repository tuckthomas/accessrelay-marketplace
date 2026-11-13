# AccessRelay Marketplace

Community Lua scripts and declarative game plugins for AccessRelay Studio. This
repository owns catalog entries, package source, licenses and submission review.
The application, controller engine and desktop interface stay in
[accessrelay-studio](https://github.com/tuckthomas/accessrelay-studio).

Open **Marketplace** in Studio to browse, inspect source and install a package.
Installed packages appear under **Controller â†’ Plugins**. Creating a controller
profile and enabling its scripts are separate user actions.

## Contribute

1. Fork this repository and add `packages/<id>/<version>/pack.json` plus its declared
   Lua resources. Use the app's version-1 game-pack contract.
2. Include the author's name, a license, source and a useful description. Only submit
   material you have permission to distribute. Keep packages independent of the app.
3. Add a listing to `catalog.json`, including the SHA-256 of the exact `pack.json`
   bytes. Assets declare their individual sizes and SHA-256 hashes in the manifest.
4. Run `python tools/validate.py`, then submit a pull request. Versioned packages
   are immutable; publish a new version for changes.

Catalog schema: `schemaVersion: 1`, `entries: []`. Every listing includes `id`,
`name`, `description`, `author`, `version`, `kind` (`script`, `controller-profile`, `plugin`, or `training-plugin`), `license`,
`manifestPath`, `manifestSha256`, and `tags`. Game-specific new listings also use
`gameId`, matching the manifest. Paths use
`packages/<id>/<version>/pack.json`. Listings and manifests must agree on identity,
version, name and license.

A script listing wraps one or more sandboxed Lua scripts in the standard pack
format. Game plugins can add declarative tuning/bindings and supported typed vision
resources. This does not load arbitrary native DLLs, JavaScript UI, Python code or
new model runtimes. Host API changes belong in the application repository.

The catalog contains separate **NBA 2K27 Model Training** and **NBA 2K27 Rhythm
Script** packages. The training package declares `gameId: nba2k27` and the reviewed
`trainingAdapter: nba2k27-training-v1`. Studio enables its NBA workspace only after
installation. The controller script cannot enable that workspace. The package
contains no trained tracker or release-model weights.

Training captures keep the gameplay scene (court, player, moving meter and room
above the floor) plus the fixed shot feedback HUD and synchronized controller input.
Player and meter tracking must be trained and validated from this evidence; a
full-scene overview is not a release-model player crop. The earlier sample packages
remain unlisted. Published versioned sources are immutable.
