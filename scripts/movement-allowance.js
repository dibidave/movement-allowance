/**
 * Movement Allowance — per-turn movement limits (Foundry v13+).
 * Actor flags: scope = module id (`movement-allowance`). Keys: allowanceMax, allowanceCurrent, allowanceExempt.
 */

const MODULE_ID = "movement-allowance";
const FLAG_SCOPE = MODULE_ID;
const FLAG_MAX = "allowanceMax";
const FLAG_CURRENT = "allowanceCurrent";
const FLAG_EXEMPT = "allowanceExempt";
const ATTR_BAR_CURRENT = `flags.${MODULE_ID}.allowanceCurrent`;
const SETTING_KEYS = {
  enabled: "enabled",
  gmMove: "gmMove",
  defaultAllowance: "defaultAllowance",
  scope: "scope",
  exemptActorTypes: "exemptActorTypes",
  resetScope: "resetScope",
  barVisibility: "barVisibility",
};

const TOKEN_CONFIG_TAB = "movement-allowance";

/** @type {Map<string, number>} actor id → reserved distance not yet written to flags */
const reservedMovement = new Map();
/** @type {Map<string, Promise<void>>} */
const actorUpdateChains = new Map();

function localize(key) {
  return game.i18n.localize(`MOVEMENT_ALLOWANCE.${key}`);
}

function localizeSetting(key) {
  return game.i18n.localize(`MOVEMENT_ALLOWANCE.Settings.${key}`);
}

function getEffectiveMax(actor) {
  const override = actor.getFlag(FLAG_SCOPE, FLAG_MAX);
  if (typeof override === "number" && !Number.isNaN(override)) return override;
  return game.settings.get(MODULE_ID, SETTING_KEYS.defaultAllowance);
}

/**
 * @param {Actor} actor
 */
function getFlagCurrent(actor) {
  const maxV = getEffectiveMax(actor);
  const cur = actor.getFlag(FLAG_SCOPE, FLAG_CURRENT);
  if (cur === undefined) return maxV;
  return cur;
}

/**
 * @param {Actor} actor
 */
function getEffectiveRemaining(actor) {
  const base = getFlagCurrent(actor);
  const r = reservedMovement.get(actor.id) ?? 0;
  return base - r;
}

function isExemptActor(actor) {
  if (actor.getFlag(FLAG_SCOPE, FLAG_EXEMPT) === true) return true;
  const types = game.settings.get(MODULE_ID, SETTING_KEYS.exemptActorTypes) ?? [];
  if (!Array.isArray(types) || !types.length) return false;
  return types.includes(actor.type);
}

/**
 * @param {TokenDocument} token
 * @param {User} initiatingUser
 */
function shouldEnforceToken(token, initiatingUser) {
  if (!game.settings.get(MODULE_ID, SETTING_KEYS.enabled)) return false;
  if (game.settings.get(MODULE_ID, SETTING_KEYS.gmMove) && initiatingUser.isGM) return false;
  const actor = token.actor;
  if (!actor) return false;
  if (isExemptActor(actor)) return false;
  const scope = game.settings.get(MODULE_ID, SETTING_KEYS.scope);
  if (scope === "pcs" && !actor.hasPlayerOwner) return false;
  return true;
}

/**
 * @param {TokenDocument} token
 */
function tokenUsesAllowanceBar(token) {
  const a1 = token.bar1?.attribute ?? "";
  const a2 = token.bar2?.attribute ?? "";
  const path = `${MODULE_ID}.allowanceCurrent`;
  return a1.includes(path) || a2.includes(path);
}

function syncBarVisibilityForToken(token) {
  if (!game.user.isGM) return;
  if (!tokenUsesAllowanceBar(token)) return;
  const vis = game.settings.get(MODULE_ID, SETTING_KEYS.barVisibility);
  const mode = vis === "all" ? CONST.TOKEN_DISPLAY_MODES.ALWAYS : CONST.TOKEN_DISPLAY_MODES.OWNER;
  if (token.displayBars === mode) return;
  void token.update({ displayBars: mode });
}

async function applyBarVisibilityGlobally() {
  if (!game.user.isGM) return;
  for (const scene of game.scenes) {
    for (const t of scene.tokens) {
      syncBarVisibilityForToken(t);
    }
  }
}

/**
 * V13 `TrackedAttributesDescription.bar` entries are `[valuePath, maxPath]` where each path is
 * an array of string segments (not a single dot-separated string), or core calls `.split` on the wrong type.
 */
const ALLOWANCE_BAR_PATHS = [
  ["flags", MODULE_ID, "allowanceCurrent"],
  ["flags", MODULE_ID, "allowanceMax"],
];

function dotPathToSegments(path) {
  if (typeof path !== "string") return null;
  return path.split(".").filter(Boolean);
}

/**
 * @param {unknown} row
 * @returns {[string[], string[]]|null}
 */
function normalizeBarRow(row) {
  if (!Array.isArray(row) || row.length !== 2) return null;
  const [a, b] = row;
  let segs0;
  let segs1;
  if (typeof a === "string") segs0 = dotPathToSegments(a);
  else if (Array.isArray(a) && a.every((x) => typeof x === "string")) segs0 = a;
  else return null;
  if (typeof b === "string") segs1 = dotPathToSegments(b);
  else if (Array.isArray(b) && b.every((x) => typeof x === "string")) segs1 = b;
  else return null;
  return [segs0, segs1];
}

function barPathsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function hasAllowanceBarRow(bar) {
  return bar.some((row) => {
    const n = normalizeBarRow(row);
    return n && barPathsEqual(n, ALLOWANCE_BAR_PATHS);
  });
}

function actorTypesFromSystem() {
  const raw = game.system?.documentTypes?.Actor;
  if (Array.isArray(raw)) return [...raw];
  if (raw && typeof raw === "object") return Object.keys(raw);
  const models = CONFIG.Actor?.dataModels;
  if (models && typeof models === "object") return Object.keys(models);
  return [];
}

/**
 * @param {object} entry
 */
function normalizeTrackableEntry(entry) {
  if (!entry || typeof entry !== "object") return { bar: [], value: [] };
  return {
    bar: Array.isArray(entry.bar) ? entry.bar : [],
    value: Array.isArray(entry.value) ? entry.value : [],
  };
}

/**
 * V13 expects CONFIG.Actor.trackableAttributes[actorType].bar rows as segment-array pairs.
 */
function mergeAllowanceTrackableAttributes() {
  if (!CONFIG.Actor.trackableAttributes) CONFIG.Actor.trackableAttributes = {};
  const ta = CONFIG.Actor.trackableAttributes;
  const types = actorTypesFromSystem();

  const ensureEntry = (type) => {
    let entry = ta[type];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      entry = { bar: [], value: [] };
      ta[type] = entry;
    } else {
      const norm = normalizeTrackableEntry(entry);
      ta[type] = { ...entry, bar: norm.bar, value: norm.value };
      entry = ta[type];
    }
    entry.bar = entry.bar.map((row) => normalizeBarRow(row) ?? row);
    if (!hasAllowanceBarRow(entry.bar)) {
      entry.bar.push(ALLOWANCE_BAR_PATHS.map((segments) => [...segments]));
    }
  };

  if (types.length) {
    for (const type of types) ensureEntry(type);
    return;
  }

  for (const key of Object.keys(ta)) {
    const val = ta[key];
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    if (!("bar" in val) && !("value" in val)) continue;
    ensureEntry(key);
  }
}

/**
 * @param {TokenDocument} tokenDoc
 * @param {object} movement
 */
function measureMovementDistance(tokenDoc, movement) {
  const grid = canvas?.grid;
  if (!grid?.measurePath) return 0;

  const waypoints = [];
  const addPt = (pt) => {
    if (pt && typeof pt.x === "number" && typeof pt.y === "number") waypoints.push({ x: pt.x, y: pt.y });
  };

  const pending = movement.pending;
  if (pending?.waypoints?.length) {
    const first = pending.waypoints[0];
    if (
      !movement.origin ||
      !first ||
      first.x !== movement.origin.x ||
      first.y !== movement.origin.y
    ) {
      addPt(movement.origin);
    }
    for (const wp of pending.waypoints) addPt(wp);
  } else {
    addPt(movement.origin);
    addPt(movement.destination);
  }

  if (waypoints.length < 2) return 0;

  try {
    const result = grid.measurePath(waypoints);
    return Math.max(0, Number(result?.distance) || 0);
  } catch (err) {
    console.warn("MovementAllowance: measurePath failed", err);
    return 0;
  }
}

/**
 * @param {Actor} actor
 * @param {number} distance
 */
function enqueueAllowanceDeduction(actor, distance) {
  reservedMovement.set(actor.id, (reservedMovement.get(actor.id) ?? 0) + distance);

  const prev = actorUpdateChains.get(actor.id) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      try {
        const maxV = getEffectiveMax(actor);
        let cur = actor.getFlag(FLAG_SCOPE, FLAG_CURRENT);
        if (cur === undefined) cur = maxV;
        const newVal = Math.max(0, cur - distance);
        await actor.setFlag(FLAG_SCOPE, FLAG_CURRENT, newVal);
      } finally {
        const left = (reservedMovement.get(actor.id) ?? 0) - distance;
        reservedMovement.set(actor.id, Math.max(0, left));
      }
    })
    .catch((err) => {
      console.error("MovementAllowance: failed to persist allowance", err);
      const left = (reservedMovement.get(actor.id) ?? 0) - distance;
      reservedMovement.set(actor.id, Math.max(0, left));
    });

  actorUpdateChains.set(actor.id, next);
}

/**
 * @param {TokenDocument} token
 */
function shouldResetToken(token) {
  const actor = token.actor;
  if (!actor) return false;
  if (isExemptActor(actor)) return false;
  const scope = game.settings.get(MODULE_ID, SETTING_KEYS.scope);
  if (scope === "pcs" && !actor.hasPlayerOwner) return false;
  return true;
}

/** @returns {TokenDocument[]} */
function allPlaceableTokenDocuments() {
  /** @type {TokenDocument[]} */
  const out = [];
  for (const scene of game.scenes) {
    for (const t of scene.tokens) out.push(t);
  }
  return out;
}

async function resetAllAllowances() {
  if (!game.user?.isGM) return;
  const scope = game.settings.get(MODULE_ID, SETTING_KEYS.resetScope);
  const tokens = scope === "world" ? allPlaceableTokenDocuments() : canvas.scene?.tokens?.contents ?? [];
  for (const token of tokens) {
    if (!shouldResetToken(token)) continue;
    const actor = token.actor;
    const maxV = getEffectiveMax(actor);
    await actor.setFlag(FLAG_SCOPE, FLAG_CURRENT, maxV);
  }
}

function refreshAllowancePanel() {
  if (game.movementAllowancePanel?.rendered) game.movementAllowancePanel.render();
}

function onBarVisibilityChange() {
  void applyBarVisibilityGlobally();
}

// --- ApplicationV2 panel -------------------------------------------------

class MovementAllowancePanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "movement-allowance-panel",
    tag: "div",
    classes: ["movement-allowance-panel"],
    window: {
      frame: true,
      positioned: true,
      resizable: false,
      title: "MOVEMENT_ALLOWANCE.PanelTitle",
    },
    position: { width: 300, height: "auto" },
  };

  static async onToggleEnabled() {
    const cur = game.settings.get(MODULE_ID, SETTING_KEYS.enabled);
    await game.settings.set(MODULE_ID, SETTING_KEYS.enabled, !cur);
    refreshAllowancePanel();
  }

  static async onToggleGmMove() {
    const cur = game.settings.get(MODULE_ID, SETTING_KEYS.gmMove);
    await game.settings.set(MODULE_ID, SETTING_KEYS.gmMove, !cur);
    refreshAllowancePanel();
  }

  static async onResetAll() {
    await resetAllAllowances();
    ui.notifications?.info(localize("EndTurnDone"));
    refreshAllowancePanel();
  }

  /**
   * @param {PointerEvent} event
   */
  _onPanelClick = (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn || !this.element.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === "toggleEnabled") void MovementAllowancePanel.onToggleEnabled();
    else if (action === "toggleGmMove") void MovementAllowancePanel.onToggleGmMove();
    else if (action === "resetAll") void MovementAllowancePanel.onResetAll();
  };

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("click", this._onPanelClick);
  }

  async _onClose(options) {
    this.element?.removeEventListener("click", this._onPanelClick);
    await super._onClose?.(options);
  }

  /** @returns {Promise<HTMLElement>} */
  async _renderHTML(_context, _options) {
    const enabled = game.settings.get(MODULE_ID, SETTING_KEYS.enabled);
    const gmMove = game.settings.get(MODULE_ID, SETTING_KEYS.gmMove);

    const wrap = document.createElement("div");
    wrap.className = "movement-allowance-panel-inner standard-form";

    wrap.innerHTML = `
      <div class="form-group">
        <button type="button" class="movement-allowance-btn movement-allowance-btn-enabled ${enabled ? "is-on" : "is-off"}" data-action="toggleEnabled">
          ${enabled ? localize("ToggleEnabled") : localize("ToggleEnabledOff")}
        </button>
      </div>
      <div class="form-group">
        <button type="button" class="movement-allowance-btn movement-allowance-btn-gmmove ${gmMove ? "is-active" : ""}" data-action="toggleGmMove">
          ${localize("ToggleGmMove")}
        </button>
      </div>
      <div class="form-group">
        <button type="button" class="movement-allowance-btn movement-allowance-btn-reset" data-action="resetAll">
          ${localize("EndTurn")}
        </button>
      </div>
    `;

    return wrap;
  }

  /**
   * @param {HTMLElement} result
   * @param {HTMLElement} content
   * @param {object} _options
   */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(result);
  }
}

// --- Hooks ----------------------------------------------------------------

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_KEYS.enabled, {
    name: localizeSetting("enabledName"),
    hint: localizeSetting("enabledHint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => refreshAllowancePanel(),
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.gmMove, {
    name: localizeSetting("gmMoveName"),
    hint: localizeSetting("gmMoveHint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => refreshAllowancePanel(),
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.defaultAllowance, {
    name: localizeSetting("defaultAllowanceName"),
    hint: localizeSetting("defaultAllowanceHint"),
    scope: "world",
    config: true,
    type: Number,
    default: 30,
    range: { min: 0, max: 9999, step: 1 },
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.scope, {
    name: localizeSetting("scopeName"),
    hint: localizeSetting("scopeHint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      pcs: localizeSetting("scopePcs"),
      all: localizeSetting("scopeAll"),
    },
    default: "pcs",
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.exemptActorTypes, {
    name: localizeSetting("exemptTypesName"),
    hint: localizeSetting("exemptTypesHint"),
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.resetScope, {
    name: localizeSetting("resetScopeName"),
    hint: localizeSetting("resetScopeHint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      scene: localizeSetting("resetScene"),
      world: localizeSetting("resetWorld"),
    },
    default: "scene",
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.barVisibility, {
    name: localizeSetting("barVisibilityName"),
    hint: localizeSetting("barVisibilityHint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      owner: localizeSetting("barOwner"),
      all: localizeSetting("barAll"),
    },
    default: "owner",
    onChange: () => onBarVisibilityChange(),
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    let tokenControl = controls?.tokens ?? controls?.token;
    if (!tokenControl && Array.isArray(controls)) {
      tokenControl = controls.find((c) => c.name === "tokens" || c.name === "token");
    }
    if (!tokenControl?.tools) return;

    const toolDef = {
      name: "movementAllowancePanel",
      order: 55,
      title: game.i18n.localize("MOVEMENT_ALLOWANCE.SceneControlTitle"),
      icon: "fas fa-person-running",
      button: true,
      visible: true,
      onChange: () => {
        game.movementAllowancePanel?.render({ force: true });
      },
    };

    if (Array.isArray(tokenControl.tools)) tokenControl.tools.push(toolDef);
    else tokenControl.tools.movementAllowancePanel = toolDef;
  });

  Hooks.on("preMoveToken", (tokenDoc, movement, _operation) => {
    const initiatingUser = game.user;
    if (!shouldEnforceToken(tokenDoc, initiatingUser)) return;

    const actor = tokenDoc.actor;
    if (!actor) return;

    const dist = measureMovementDistance(tokenDoc, movement);
    if (dist <= 0) return;

    const remaining = getEffectiveRemaining(actor);
    if (dist > remaining) return false;

    enqueueAllowanceDeduction(actor, dist);
  });
});

Hooks.once("setup", () => {
  mergeAllowanceTrackableAttributes();
});

Hooks.once("ready", () => {
  game.movementAllowancePanel = new MovementAllowancePanel();

  const maxInputId = "movement-allowance-max";
  const exemptInputId = "movement-allowance-exempt";

  Hooks.on("renderTokenConfig", (app, html) => {
    if (!game.user.isGM) return;
    const token = app.document ?? app.object;
    if (!token) return;
    const actor = token.actor;
    if (!actor) return;

    const root = html?.element ?? html;
    if (!(root instanceof HTMLElement)) return;

    const maxVal = actor.getFlag(FLAG_SCOPE, FLAG_MAX);
    const exempt = actor.getFlag(FLAG_SCOPE, FLAG_EXEMPT) === true;

    const saveFlags = async () => {
      const t = app.document ?? app.object;
      const act = t?.actor;
      if (!act) return;
      const maxInput = root.querySelector(`#${maxInputId}`);
      const exInput = root.querySelector(`#${exemptInputId}`);
      const raw = maxInput?.value?.trim() ?? "";
      if (raw === "") await act.unsetFlag(FLAG_SCOPE, FLAG_MAX);
      else {
        const n = Number(raw);
        if (!Number.isNaN(n)) await act.setFlag(FLAG_SCOPE, FLAG_MAX, n);
      }
      await act.setFlag(FLAG_SCOPE, FLAG_EXEMPT, Boolean(exInput?.checked));
    };

    app._movementAllowanceSaveFlags = saveFlags;

    const existingMax = root.querySelector(`#${maxInputId}`);
    if (existingMax) {
      existingMax.value = typeof maxVal === "number" ? String(maxVal) : "";
      const exEl = root.querySelector(`#${exemptInputId}`);
      if (exEl) exEl.checked = exempt;
      return;
    }

    const sampleItem = root.querySelector(".sheet-tabs .item, nav.tabs .item");
    const tabGroup = sampleItem?.dataset?.group ?? "main";

    const tabNav =
      root.querySelector(`.sheet-tabs[data-group="${tabGroup}"]`) ??
      root.querySelector(".sheet-tabs") ??
      root.querySelector("nav.tabs");

    const tabButton = document.createElement("a");
    tabButton.className = "item";
    tabButton.dataset.tab = TOKEN_CONFIG_TAB;
    tabButton.dataset.group = tabGroup;
    tabButton.textContent = localize("TabMovement");

    const tabBody = document.createElement("div");
    tabBody.className = "tab";
    tabBody.dataset.tab = TOKEN_CONFIG_TAB;
    tabBody.dataset.group = tabGroup;
    tabBody.innerHTML = `
      <div class="form-group">
        <label for="${maxInputId}">${localize("OverrideLabel")}</label>
        <input type="number" name="${maxInputId}" id="${maxInputId}" min="0" step="1"
          value="${typeof maxVal === "number" ? maxVal : ""}" placeholder="" />
        <p class="hint">${localize("OverrideHint")}</p>
      </div>
      <div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="${exemptInputId}" id="${exemptInputId}" ${exempt ? "checked" : ""} />
          ${localize("ExemptLabel")}
        </label>
      </div>
    `;

    if (tabNav && !tabNav.querySelector(`[data-tab="${TOKEN_CONFIG_TAB}"]`)) tabNav.appendChild(tabButton);

    const tabHost =
      root.querySelector(".sheet-body") ??
      root.querySelector("section.window-content") ??
      root.querySelector("form") ??
      root;
    if (!tabHost.querySelector(`.tab[data-tab="${TOKEN_CONFIG_TAB}"]`)) tabHost.appendChild(tabBody);

    const form = root.querySelector("form");
    if (form && !form.dataset.movementAllowanceSubmitBound) {
      form.dataset.movementAllowanceSubmitBound = "1";
      form.addEventListener(
        "submit",
        () => {
          void saveFlags();
        },
        { capture: true }
      );
    }
  });

  Hooks.on("closeTokenConfig", (app) => {
    if (!game.user.isGM) return;
    if (typeof app._movementAllowanceSaveFlags === "function") void app._movementAllowanceSaveFlags();
  });

  Hooks.on("renderSettingsConfig", (_app, html) => {
    const root = html?.element ?? html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;

    const rawTypes = game.system?.documentTypes?.Actor;
    const types = Array.isArray(rawTypes)
      ? rawTypes
      : rawTypes && typeof rawTypes === "object"
        ? Object.keys(rawTypes)
        : [];
    if (!types.length) return;

    const section =
      root.querySelector(`section[data-module-id="${MODULE_ID}"]`) ??
      root.querySelector(`div[data-module-name="${MODULE_ID}"]`) ??
      Array.from(root.querySelectorAll("h2.module-header")).find((h) =>
        h.textContent?.includes(game.modules.get(MODULE_ID)?.title ?? "Movement")
      )?.closest("section");

    const mount = section ?? root.querySelector("#settings-menu") ?? root;
    if (mount.querySelector(".movement-allowance-exempt-types")) return;

    const current = new Set(game.settings.get(MODULE_ID, SETTING_KEYS.exemptActorTypes) ?? []);

    const wrap = document.createElement("div");
    wrap.className = "form-group subgroup movement-allowance-exempt-types";
    wrap.innerHTML = `<label>${localizeSetting("exemptTypesName")}</label>
      <p class="notes">${localizeSetting("exemptTypesHint")}</p>
      <select multiple class="movement-allowance-exempt-select" size="${Math.min(types.length, 8)}"></select>`;

    const sel = wrap.querySelector("select");
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (current.has(t)) opt.selected = true;
      sel.appendChild(opt);
    }

    sel.addEventListener("change", () => {
      const chosen = Array.from(sel.selectedOptions).map((o) => o.value);
      void game.settings.set(MODULE_ID, SETTING_KEYS.exemptActorTypes, chosen);
    });

    mount.appendChild(wrap);
  });

  Hooks.on("createToken", (token) => {
    syncBarVisibilityForToken(token);
  });

  Hooks.on("updateToken", (token, changes) => {
    if (changes.bar1 || changes.bar2 || changes.displayBars) syncBarVisibilityForToken(token);
  });

  void applyBarVisibilityGlobally();
});
