# Movement Allowance

Minimal Foundry VTT module skeleton. On world load it shows an info notification: **It's working**.

## Install from GitHub (Foundry app)

1. Create a **GitHub Release** with a version tag (e.g. `v0.0.1`). A workflow attaches `module.json` and `module.zip` to that release.
2. In Foundry: **Add-on Modules** → **Install Module** → paste this manifest URL (replace `OWNER` and `REPO`):

   `https://github.com/OWNER/REPO/releases/latest/download/module.json`

## Local development

Copy or symlink this folder to `Data/modules/movement-allowance` so the directory name matches the manifest `id`. For a clean local `module.json` without CI placeholders, use a release build or temporarily set real `version`, `url`, `manifest`, and `download` values.

## Release workflow

See [.github/workflows/main.yml](.github/workflows/main.yml), based on the [FoundryVTT Module Template](https://github.com/League-of-Foundry-Developers/FoundryVTT-Module-Template).
