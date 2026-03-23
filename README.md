# Movement Allowance

A [Foundry VTT](https://foundryvtt.com/) **v13+** module that limits how far each token can move per turn. Distance uses the scene’s grid units (square, hex, or gridless). It is system-agnostic and does not require an active combat encounter.

**Testing:** In practice this module has only been exercised with **Genesys** (FVTT-Genesys) and **Star Trek Adventures**. Other systems may work, but they are untested here—report issues if something breaks.

## Features

- **Per-turn budget** — Each tracked actor has a maximum allowance per turn and a current value that decreases as the token moves. Moves that would exceed the remainder are blocked (`preMoveToken`).
- **World defaults** — Configure a default maximum in **Configure Settings** for modules without a per-token override.
- **Per-token overrides** — GMs get an **Allowance** tab on the token configuration sheet: optional max override and an **exempt** checkbox. Values persist on the actor (`flags.movement-allowance`: `allowanceMax`, `allowanceCurrent`, `allowanceExempt`).
- **GM panel** — Under **Token** scene controls, use the **Movement allowance panel** tool (running person icon) to toggle the module on/off, **GM move** (no cost for GM-only moves while players stay restricted), and **End turn** to restore allowances (current scene or whole world, per setting).
- **Who is tracked** — **Player characters only** or **Everyone** (module setting).
- **Exempt actor types** — Multi-select in **Configure Settings** (injected under this module’s section) to skip whole actor types from the active system.
- **Resource bar** — Optional bar on the token: set a bar attribute to `flags.movement-allowance.allowanceCurrent` (max is resolved via the module’s bar integration). **Bar visibility** (owner vs everyone) is a module setting and applies when the token uses that allowance bar.
- **Genesys (FVTT-Genesys)** — The system expects token bar ids under `source`; this module registers **`movementAllowance`** as an alias for the current allowance so Genesys token bars can track movement allowance like other resources.

Undoing a move does not refund spent allowance (Foundry limitation); the GM can adjust flags or use **End turn** as needed.

## Install from GitHub (Foundry)

1. Publish a **GitHub Release** with a version tag (e.g. `v0.1.0`). The workflow in [.github/workflows/main.yml](.github/workflows/main.yml) attaches `module.json` and `module.zip` to that release.
2. In Foundry: **Add-on Modules** → **Install Module** → manifest URL (replace with your repo):

   `https://github.com/OWNER/REPO/releases/latest/download/module.json`

## Module settings (summary)

| Setting | Notes |
|--------|--------|
| Movement allowance enabled | Controlled from the GM panel (`config: false` in manifest). |
| GM move mode | Same; bypass cost for GM moves only. |
| Default allowance | Shown in **Configure Settings**; grid units. |
| Who is tracked | PCs only vs everyone. |
| End turn reset scope | Current scene vs all scenes. |
| Allowance bar visibility | Owner + GM vs everyone (for tokens using the allowance bar). |
| Exempt actor types | Multi-select UI under the module block in **Configure Settings**. |

## Local development

Copy or symlink this folder to `Data/modules/movement-allowance` so the directory name matches the manifest `id`. The checked-in `module.json` uses CI placeholders (`#{VERSION}#`, etc.); for a local install, either use artifacts from a release build or temporarily set real `version`, `url`, `manifest`, and `download` values.

## Documentation

Design intent and implementation notes for collaborators live under [docs/](docs/) (for example [MoveBudget_Intent.md](docs/MoveBudget_Intent.md)).

## Release workflow

Releases are built with [League-of-Foundry-Developers/FoundryVTT-Module-Template](https://github.com/League-of-Foundry-Developers/FoundryVTT-Module-Template)-style token replacement on `module.json` and a `module.zip` containing `module.json`, `README.md`, `LICENSE`, `scripts/`, `styles/`, and `languages/`. See [.github/workflows/main.yml](.github/workflows/main.yml) for details.
