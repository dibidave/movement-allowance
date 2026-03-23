# MoveBudget
## A Foundry VTT Module — What It Is & What It Does

---

## What Is It?

MoveBudget is a module for Foundry VTT that gives the GM control over how far tokens can move during play. Each token gets a movement allowance per turn. As the token moves, that allowance depletes. Once it runs out, the token cannot be moved further until the GM resets it.

It works with any game system. It does not require an active combat encounter. It works on any map type — square grids, hex grids, and gridless scenes alike.

---

## The Basics

### Movement Allowance

Every tracked token has two values:

- **Maximum Budget** — the total distance that token is allowed to move per turn. Set by the GM.
- **Current Budget** — how much movement the token has left this turn. Depletes as the token moves.

When a token is moved on the map, the distance traveled is subtracted from its current budget automatically. If a move would exceed the remaining budget, it is blocked and the token snaps back to where it was. No pop-up, no message — it just stops.

### The Movement Bar

Each tracked token displays a resource bar showing its remaining movement, the same way HP bars work in Foundry. Players can see their own token's bar. By default, players cannot see other players' bars or NPC bars — only the GM sees those. This can be changed to show everyone's bars if preferred.

---

## GM Controls

The GM has a small control panel accessible from the sidebar at all times. It contains three controls:

### ON / OFF
The master switch for the entire module. When off, all tokens move freely with no restrictions — useful for theater-of-the-mind sections of the session where tracking movement is not important. Flip it back on when it matters again.

### GM MOVE
A temporary bypass for the GM only. When active, the GM can reposition any token on the map without it costing that token any movement. Players remain fully restricted during this time. Intended for staging NPCs into position, correcting a misplaced token, or any moment the GM needs to move things around freely mid-scene without affecting the turn economy.

### RESET ALL
Resets every tracked token's current budget back to its maximum. This represents the start of a new turn or round. The GM controls when this happens — the module does not tie it to any combat or initiative system.

---

## Setting It Up

### Default Movement Allowance

In the module settings, the GM sets a default movement allowance that applies to all tracked tokens automatically. Any token that does not have a specific override will use this value.

### Per-Token Overrides

For tokens that need a different allowance — a faster creature, a heavily encumbered character, a vehicle — the GM can set an individual override directly in the token's settings. Right-click any token, open its configuration, and a new Movement tab is added by the module. From there the GM can set a custom maximum budget for that specific token, or mark it as exempt entirely.

This is intended to be configured before the session starts, not in the middle of play.

### Exempting Tokens

Any individual token can be marked as exempt, meaning the module will never restrict its movement regardless of any other setting. Additionally, entire actor categories can be exempted in the module settings — for example, if a game system has a vehicle actor type, all vehicles can be excluded from movement tracking globally without having to exempt them one by one.

---

## Who Gets Tracked?

The GM can choose from two modes:

- **Player Characters Only** — only tokens belonging to players have their movement tracked and restricted. NPC movement is unrestricted.
- **Everyone** — all tokens in the scene are tracked, including NPCs.

The Reset button can also be scoped: either reset only the tokens in the current active scene, or reset all tracked tokens across every scene in the world.

---

## Things to Know

- **It does not require combat to be running.** The module works entirely independently of Foundry's combat tracker. It is purely about controlling token movement on the map.

- **Undoing a move does not restore budget.** If a player uses Ctrl+Z to undo a token move, the token returns to its prior position but the movement it spent is not refunded. The GM can correct this manually from the token settings if needed.

- **The token bar occupies one of two bar slots.** Foundry natively supports two resource bars per token. The MoveBudget bar will use one of those slots. If both slots are already in use, the Bar Brawl module (a separate free module) allows additional bars and resolves this.

- **Player character budgets persist between scenes.** If a player character moves to a new scene mid-turn, their remaining movement budget carries over. It does not reset on scene transfer.

---

*"A simple, system-agnostic tool that gives the GM full control over how far tokens can move — nothing more, nothing less."*

*MoveBudget | Foundry VTT | System Agnostic*
