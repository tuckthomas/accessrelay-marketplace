# AccessRelay Marketplace

Community Lua scripts and declarative game plugins for AccessRelay Studio. This
repository owns catalog entries, package source, licenses and submission review.
The application, controller engine and desktop interface stay in
[accessrelay-studio](https://github.com/tuckthomas/accessrelay-studio).

Open **Marketplace** in Studio to browse, inspect source and install a package.
Installed packages appear under **Controller → Plugins**. Creating a controller
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
`name`, `description`, `author`, `version`, `kind` (`script` or `plugin`), `license`,
`manifestPath`, `manifestSha256`, and `tags`. Paths use
`packages/<id>/<version>/pack.json`. Listings and manifests must agree on identity,
version, name and license.

A script listing wraps one or more sandboxed Lua scripts in the standard pack
format. Game plugins can add declarative tuning/bindings and supported typed vision
resources. This does not load arbitrary native DLLs, JavaScript UI, Python code or
new model runtimes. Host API changes belong in the application repository.

The initial packages are small AccessRelay-authored examples, clearly attributed
as such. They are not a claim of an existing community library or gameplay model.
