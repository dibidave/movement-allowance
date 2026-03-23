# Movement Allowance
## Foundry VTT Module — Implementation Guide
**Version 1.0 | Target: Foundry VTT V13+ | System Agnostic**

---

## 1. Overview

Movement Allowance is a system-agnostic Foundry VTT module that enforces per-token movement limits during play. It tracks how far a token has moved per turn, blocks further movement once that limit is exhausted, and gives the GM simple accessible controls to manage and reset those limits at any time.

The module works across all grid types — square, hex, and gridless — requires no active combat encounter, and makes no assumptions about the underlying game system. It integrates with Foundry's base Actor document so it functions with any system that builds on Foundry's standard Actor architecture.

**Core behaviors at a glance:**

- Each token has a defined movement allowance per turn (`allowanceMax`).
- A live remaining value (`allowanceCurrent`) depletes as the token moves.
- When `allowanceCurrent` reaches zero, further movement is blocked.
- The GM can reset all budgets at any time via a dedicated control panel.
- The entire system can be toggled on or off instantly.
- The GM can enter GM Move mode to reposition tokens freely without consuming budgets.
- Individual tokens and entire actor type categories can be exempted from tracking.

---

## 2. Terminology & Naming Conventions

All internal flags, settings keys, and code references use standardized terms throughout. Consistency here prevents confusion during development and avoids collisions with system-defined attributes.

| Term | Meaning |
|---|---|
| `allowanceMax` | The total movement allowance per turn — the ceiling the token resets to. |
| `allowanceCurrent` | The live remaining movement for this turn. This is the value that depletes. |
| `movement-allowance` | Package id and Foundry **flag scope** (`getFlag` / `setFlag` first argument). Flag **keys** use `allowance*` names below. |
| GM Move | A temporary mode where the GM can move tokens without consuming their budgets. |
| Exempt | A token or actor type excluded from all enforcement regardless of other settings. |

> **⚠️ Do not use the bare word `speed` anywhere in the codebase.** Almost every RPG system already defines an attribute named `speed` on their actor data model. Using it as a bare key risks collisions. All values must be stored under actor flags scoped to the module id (`movement-allowance`) with keys such as `allowanceMax` / `allowanceCurrent` (never use a separate scope string that is not an active package id).

---

## 3. Technical Foundation

### 3.1 Target Version

Foundry VTT V13 only. No V12 compatibility is required or intended. Some APIs referenced in this guide are V13-specific and do not exist in earlier versions.

### 3.2 Movement Interception

Use the `preMoveToken` hook exclusively for intercepting token movement. This hook fires before a token moves and supports returning `false` to block the movement entirely before it occurs.

> **⚠️ Do NOT use `preUpdateToken` for movement blocking in V13.** It is the wrong tool for this purpose. `preMoveToken` is the correct and intended hook.

The `preMoveToken` hook handles all movement input types uniformly:

- Freeform token dragging
- Arrow key movement
- All grid types: square, hex, and gridless

When a move is blocked, returning `false` causes the token to snap back to its prior position silently. No notification or animation is required — the snap-back itself communicates the block.

### 3.3 Distance Measurement

Use `canvas.grid.measurePath()` for all distance calculations. Do not write custom distance math. This method:

- Returns distance in the scene's configured units (feet, meters, etc.)
- Handles square grids, hex grids, and gridless scenes correctly
- Is the same measurement method Foundry uses natively for ruler tools

> **Developer note:** Test `canvas.grid.measurePath()` output specifically on gridless scenes. On gridless, distances are calculated from pixel positions and converted to scene units. Verify the output is sensible before shipping.

### 3.4 Data Storage

Both `allowanceMax` and `allowanceCurrent` are stored as flags on the **Actor document**, not on the Token document. This is a critical architectural decision.

**Why Actor flags and not Token flags:**

- Linked tokens (standard for player characters) share their data with a single Actor document. Storing on the Actor means the budget persists when a linked token appears in a new scene — no reset occurs on scene transfer.
- Token documents in Foundry are scene-specific. Storing on the Token would lose data on scene transfer.

> **Note:** Unlinked tokens (typical for NPCs) are scene-specific by design and do not benefit from this cross-scene persistence. This is acceptable for V1 since NPCs rarely transfer between scenes mid-turn.

### 3.5 Token Bar Display

Register movement allowance as a token attribute by surfacing it as a `value`/`max` pair in the Actor's registered attributes. This makes it available natively in Foundry's token resource bar system with no custom bar rendering code required.

In **V13**, each row in `CONFIG.Actor.trackableAttributes[actorType].bar` must be a **pair of dot-separated path strings** (e.g. `flags.movement-allowance.allowanceCurrent` and `…allowanceMax`). Core calls `.split(".")` on each path; if a row uses segment **arrays** instead of strings, TokenConfig throws `attr.split is not a function`. The module normalizes any segment-array rows it finds back to strings when merging.

**What this provides for free:**

- The bar appears as an option in the Token Config Resources tab alongside HP and other system attributes.
- Bar visibility (owner-only vs. everyone) is controlled by Foundry's existing `displayBars` token setting — no custom visibility logic needed.
- The bar depletes and fills visually as `allowanceCurrent` changes.

> **Bar Slot Limitation:** Foundry natively supports two token bar slots (Bar 1 below the token, Bar 2 above). This module’s bar will occupy one of these slots. Users running the Bar Brawl module can add it as an additional bar without displacing existing ones. Document this in the module readme.

### 3.6 Grid Units

Allowance values are entered and displayed in the scene's native distance units, inherited directly from `canvas.grid.measurePath()` output. No separate unit conversion or label system is implemented in V1. The GM sets `allowanceMax` in the same units the scene uses, keeping the system consistent with native Foundry behavior.

---

## 4. Data Architecture

The following flags are stored on each Actor document under scope **`movement-allowance`** (the module id):

| Flag Key | Type | Description |
|---|---|---|
| `flags.movement-allowance.allowanceMax` | number | Total movement allowance per turn (the ceiling). |
| `flags.movement-allowance.allowanceCurrent` | number | Remaining movement this turn (live depleting value). |
| `flags.movement-allowance.allowanceExempt` | boolean | Skip all enforcement for this token. |

`allowanceMax` is set by the GM and represents the value the token resets to at the start of each turn. It is configured before play begins and changed infrequently. `allowanceCurrent` is the live value that changes constantly during play and is the value displayed on the token bar.

---

## 5. Module Settings

Register all of the following via `game.settings.register`. All settings are GM-only (`scope: 'world'`) unless otherwise noted.

| Key | Type | Default | Scope | Description |
|---|---|---|---|---|
| `enabled` | Boolean | `false` | World | Master on/off switch. When false the module is fully dormant. |
| `gmMove` | Boolean | `false` | World | GM Move mode. Bypasses enforcement only for the GM. Players remain enforced. |
| `defaultAllowance` | Number | `30` | World | Default `allowanceMax` for any token without a per-token override. |
| `scope` | String | `"pcs"` | World | `"pcs"` enforces player-owned tokens only. `"all"` enforces every token. |
| `exemptActorTypes` | Array | `[]` | World | Actor types excluded from enforcement. Populated from `game.system.documentTypes.Actor` at runtime. |
| `resetScope` | String | `"scene"` | World | `"scene"` resets tokens in the active scene. `"world"` resets tokens across all scenes. |
| `barVisibility` | String | `"owner"` | World | `"owner"` — only the token owner and GM see the bar. `"all"` — everyone sees it. |

> **Note:** The `exemptActorTypes` setting must populate its UI by reading `game.system.documentTypes.Actor` at runtime. This gives a list of all actor types the currently active system defines without any hardcoded system names. This is the primary mechanism that keeps the module system-agnostic.

---

## 6. Token Configuration — Movement Tab

Inject a new **Allowance** tab into the Token Config sheet (the window opened by right-clicking a token and selecting Open Configuration). Use the `renderTokenConfig` hook for this injection.

This tab must only render when `game.user.isGM` is `true`. Players never see it.

### 6.1 Tab Contents

#### Allowance override (numeric input)

A numeric input field. When populated, this value overrides the module's **Default allowance** setting for this specific token. It sets `allowanceMax` on the token's Actor. Leave blank to inherit the module default.

This field is intended to be set before play begins — for example, assigning a higher value to a particularly fast creature. It sets the maximum budget, not the current remaining value.

#### Exempt This Token (checkbox)

When checked, sets `flags.movement-allowance.allowanceExempt` to `true` on the Actor. This token will never have movement blocked regardless of any other setting. Its allowance is not tracked or deducted.

### 6.2 Implementation Notes

- Use the `renderTokenConfig` hook to inject the tab HTML and wire up form submission.
- All form field IDs in this tab must use the module id as a prefix (e.g. `movement-allowance-max`, `movement-allowance-exempt`) to avoid conflicts with other modules injecting into the same sheet.
- The isometric tab added by other modules is an example of this exact same pattern — there is no tab limit and properly namespaced tabs do not conflict with each other.

---

## 7. Movement Enforcement Logic

The following logic executes inside the `preMoveToken` hook on every token move attempt. Checks are evaluated in order. The first condition that matches terminates evaluation — no further checks run.

| # | Condition | Result |
|---|---|---|
| 1 | `enabled` is `false` | No enforcement. Module is dormant. |
| 2 | `gmMove` is `true` AND mover is GM | No enforcement. Budget not deducted. |
| 3 | Token Actor has `allowanceExempt` flag = `true` | No enforcement for this token. |
| 4 | Actor type is in `exemptActorTypes` | No enforcement for this token. |
| 5 | `scope` is `"pcs"` AND `actor.hasPlayerOwner` is `false` | No enforcement for this token. |
| 6 | Move distance > `allowanceCurrent` | Return `false`. Move blocked. Token snaps back silently. |
| 7 | All checks passed, move is within budget | Allow move. Deduct distance from `allowanceCurrent`. |

### 7.1 GM Move Mode Detail

GM Move is not a global bypass. When the `gmMove` setting is `true`, the `preMoveToken` hook must check the identity of the user initiating the move:

```js
if (settings.gmMove && game.user.isGM) { return; } // Skip enforcement for this move
```

If a player moves their token while GM Move is active, enforcement applies normally. Only moves initiated by a GM-role user are bypassed. This is essential — GM Move is a tool for the GM to reposition tokens without spending budgets, not a general free-movement mode.

### 7.2 Budget Deduction

When a move passes all checks and is within budget (step 7), deduct the move distance from `allowanceCurrent` using an Actor flag update.

> **Developer note:** The flag update in step 7 is asynchronous. Be deliberate about update ordering to ensure the deduction is committed before a second rapid move attempt is evaluated. A race condition here could allow a token to over-spend its budget if moved twice in quick succession.

### 7.3 Undo Limitation

Foundry's native undo system (Ctrl+Z) restores a token's position but has no awareness of module flags. If a player undoes a valid move, the token returns to its prior position but `allowanceCurrent` remains at the post-move (lower) value — the budget is not restored.

This is a known limitation and is accepted in V1. The GM can correct this manually by editing the token's allowance override in the **Allowance** tab, or by using **End turn** on the control panel. Document this limitation in the module readme.

---

## 8. GM Control Panel

Implement the control panel as a small `ApplicationV2` instance in V13. It should be launchable from a button in the scene controls sidebar (the left toolbar in Foundry's main interface) and remain accessible to the GM at all times without navigating into menus.

The panel should be compact and minimizable. Its purpose is fast, mid-session access — not configuration. Keep the UI minimal.

### 8.1 Controls

#### System On/Off Toggle

A large, clearly labeled toggle button. Reflects and sets the `enabled` module setting. Visual state must be immediately obvious — for example, a green active state and a red inactive state, or clear labeled text. This is the master switch for the entire module.

**Use case:** Toggled off for theater-of-the-mind sections of the session where movement tracking is irrelevant. Tokens move freely for all users. Toggled back on when the scene shifts to a context where movement matters.

#### GM Move Toggle

A secondary toggle button, visually distinct from the On/Off toggle. When active, the button should display an obvious active state (e.g. amber/yellow) so the GM knows it is on.

**Use case:** The module is active and movement is being tracked, but the GM needs to reposition one or more tokens right now without consuming their budgets — for example, moving NPCs into position for a scene, or correcting a player token that was misclicked. The GM activates GM Move, repositions whatever tokens are needed, then deactivates it. Players remain fully enforced throughout.

> **⚠️ GM Move only bypasses enforcement for moves initiated by a GM-role user. Players cannot exploit this mode — their movement is enforced normally regardless of whether GM Move is on.**

#### Reset Button

A single button labeled **Reset All Movement**. When clicked, it iterates over the appropriate token set (determined by the `resetScope` setting) and sets each tracked, non-exempt token's `allowanceCurrent` equal to its `allowanceMax`. This represents the start of a new turn or round.

**Reset scope behavior:**
- `"scene"` — resets all tracked non-exempt tokens in the currently active scene only.
- `"world"` — resets all tracked non-exempt tokens across all scenes.

### 8.2 State Persistence

All three controls must write their state to module settings via `game.settings.set`, not to local variables. This ensures the state is shared across all connected clients. If the GM toggles GM Move on, that state must be reflected for all users — a player's `preMoveToken` hook evaluation needs to read the current `gmMove` value from settings, not from a local copy.

---

## 9. Scene Transfer Behavior

### Linked Tokens (Player Characters)

Because `allowanceMax` and `allowanceCurrent` are stored on the Actor document, the data persists naturally when a linked token appears in a new scene. No additional hook handling is required. The token carries its current remaining budget into the new scene exactly as intended.

### Unlinked Tokens (NPCs)

Unlinked tokens are scene-specific. Each scene instance of an unlinked token is an independent token document, and the Actor flags do not automatically carry over. Cross-scene budget persistence for unlinked tokens is out of scope for V1. This is an acceptable limitation since NPCs rarely transfer between scenes mid-turn.

---

## 10. Known Limitations & Developer Notes

- **Undo does not restore allowance.** Foundry's Ctrl+Z restores token position but not module flags. See Section 7.3.
- **Two native token bar slots.** Movement Allowance occupies one of Foundry's two native bar slots. The Bar Brawl module resolves this for users who need additional bars. Note this in the module readme.
- **Unlinked token scene persistence not implemented.** Budget carry-over on scene transfer works for linked tokens (PCs) only. V1 limitation.
- **No unit label system.** Allowance values use the scene's native units. No separate labeling layer is implemented in V1.
- **System agnosticism is enforced by design.** The module reads only `actor.type`, `actor.hasPlayerOwner`, and module-namespaced flags. It never reads system-specific actor data.
- **Gridless scene testing required.** `canvas.grid.measurePath()` behaves differently on gridless scenes. The developer must verify output is sensible on gridless before release.
- **Async deduction race condition.** The flag update deducting spent budget is asynchronous. The developer must ensure deduction is committed before a rapid second move attempt is evaluated. See Section 7.2.
