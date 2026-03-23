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

/** Genesys (FVTT-Genesys) uses `source` token attribute ids, not flag dot paths — see GenesysTokenDocument. */
const MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY = "movementAllowance";

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
  const toStr = (a) => trackablePathToDotString(a) ?? "";
  const a1 = token.bar1?.attribute;
  const a2 = token.bar2?.attribute;
  const s1 = typeof a1 === "string" ? a1 : toStr(a1);
  const s2 = typeof a2 === "string" ? a2 : toStr(a2);
  const path = `${MODULE_ID}.allowanceCurrent`;
  return (
    s1.includes(path) ||
    s2.includes(path) ||
    a1 === MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY ||
    a2 === MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY
  );
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

/** Max flag path (for bar attribute matching); current is `ATTR_BAR_CURRENT` at top of file. */
const ATTR_BAR_MAX = `flags.${MODULE_ID}.allowanceMax`;

/** Segment arrays for `getTrackedAttributes` / `getTrackedAttributeChoices` (core maps with `v.join(".")`). */
const ALLOWANCE_BAR_SEGMENTS_CURRENT = ["flags", MODULE_ID, FLAG_CURRENT];
const ALLOWANCE_BAR_SEGMENTS_MAX = ["flags", MODULE_ID, FLAG_MAX];

/**
 * @param {unknown} pathlike
 * @returns {string|null}
 */
function trackablePathToDotString(pathlike) {
  if (typeof pathlike === "string") return pathlike;
  if (Array.isArray(pathlike) && pathlike.every((x) => typeof x === "string")) return pathlike.join(".");
  return null;
}

/**
 * @param {unknown} entry bar row from getTrackedAttributes (segment[] or legacy dot string)
 * @returns {string}
 */
function trackableBarEntryKey(entry) {
  const s = trackablePathToDotString(entry);
  return s ?? "";
}

/**
 * @param {unknown} entry
 * @returns {string[]}
 */
function barEntryToSegments(entry) {
  if (Array.isArray(entry) && entry.length && entry.every((x) => typeof x === "string")) return entry;
  if (typeof entry === "string" && entry.length) return entry.split(".");
  return [];
}

const ALLOWANCE_BAR_MAX_DOT = ALLOWANCE_BAR_SEGMENTS_MAX.join(".");
const ALLOWANCE_BAR_CURRENT_DOT = ALLOWANCE_BAR_SEGMENTS_CURRENT.join(".");

/**
 * Dedupe bar rows, coerce to segment arrays, drop standalone allowance max (max is supplied via
 * `getBarAttribute` when the bar uses allowanceCurrent). Optionally inject current once for exempt-aware
 * `getTrackedAttributes` calls.
 * @param {unknown[]} bar
 * @param {{ injectAllowanceCurrent?: boolean }} [options]
 * @returns {string[][]}
 */
function finalizeBarDescriptorForAllowance(bar, options = {}) {
  const injectAllowanceCurrent = Boolean(options.injectAllowanceCurrent);
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(bar) ? bar : []) {
    const segs = barEntryToSegments(e);
    if (!segs.length) continue;
    const k = segs.join(".");
    if (k === ALLOWANCE_BAR_MAX_DOT) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(segs);
  }
  if (injectAllowanceCurrent && !seen.has(ALLOWANCE_BAR_CURRENT_DOT)) {
    out.push([...ALLOWANCE_BAR_SEGMENTS_CURRENT]);
    seen.add(ALLOWANCE_BAR_CURRENT_DOT);
  }
  return out;
}

/**
 * @param {unknown[]} value
 * @returns {unknown[]}
 */
function dedupeTrackableValueEntries(value) {
  if (!Array.isArray(value)) return value;
  const out = [];
  const seen = new Set();
  for (const e of value) {
    const segs = barEntryToSegments(e);
    const k = segs.length ? segs.join(".") : trackableBarEntryKey(e);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(segs.length ? segs : e);
  }
  return out;
}

/**
 * Infer actor document type from the first argument to `TokenDocument.getTrackedAttributes`.
 * @param {unknown} data
 * @returns {string|null}
 */
function resolveActorTypeForTrackedData(data) {
  if (typeof data === "string" && data.length > 0) return data;
  const models = CONFIG.Actor?.dataModels;
  if (!data || typeof data !== "object" || !models) return null;
  for (const [type, Model] of Object.entries(models)) {
    try {
      if (Model && data instanceof Model) return type;
    } catch {
      /* instanceof can throw for cross-realm prototypes */
    }
  }
  return null;
}

function shouldInjectAllowanceTrackablePathsForType(type) {
  if (!type) return true;
  const exempt = game.settings.get(MODULE_ID, SETTING_KEYS.exemptActorTypes) ?? [];
  if (!Array.isArray(exempt) || exempt.length === 0) return true;
  return !exempt.includes(type);
}

/**
 * Merge allowance into a `getTrackedAttributes` descriptor. Genesys returns `{ source }` and never calls
 * `super` (Mezryss/FVTT-Genesys `GenesysTokenDocument`), so bar[] is ignored for the Resources UI.
 * @param {object|null|undefined} desc
 * @param {unknown} data
 * @returns {object|null|undefined}
 */
function mergeAllowanceIntoTrackedDescriptor(desc, data) {
  if (!desc || typeof desc !== "object") return desc;
  const type = resolveActorTypeForTrackedData(data);
  const inject = !type || shouldInjectAllowanceTrackablePathsForType(type);
  if (!inject) return desc;

  if ("source" in desc && desc.source && typeof desc.source === "object") {
    if (desc.source[MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY]) return desc;
    return {
      ...desc,
      source: {
        ...desc.source,
        [MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY]: {
          label: localize("BarResourceLabel"),
          isBar: true,
          editable: true,
          valuePath: "_movementAllowance.value",
          maxPath: "_movementAllowance.max",
        },
      },
    };
  }

  const bar = finalizeBarDescriptorForAllowance(Array.isArray(desc.bar) ? desc.bar : [], {
    injectAllowanceCurrent: inject,
  });
  return { ...desc, bar };
}

/**
 * @param {TokenDocument} tokenDoc
 * @param {string} barName
 * @param {object} [options]
 * @returns {object|null}
 */
function tryMovementAllowanceBarAttribute(tokenDoc, barName, options) {
  const opts = options ?? {};
  const spec = tokenDoc[barName];
  const rawAttr = opts.alternative !== undefined ? opts.alternative : spec?.attribute;
  if (rawAttr === MOVEMENT_ALLOWANCE_GENESYS_TOKEN_KEY) {
    const actor = tokenDoc.actor;
    if (actor) {
      return {
        type: "bar",
        attribute: rawAttr,
        value: getFlagCurrent(actor),
        max: getEffectiveMax(actor),
        editable: true,
      };
    }
  }
  const pathDot = trackablePathToDotString(rawAttr);
  if (pathDot === ATTR_BAR_CURRENT) {
    const actor = tokenDoc.actor;
    if (actor) {
      return {
        type: "bar",
        attribute: typeof rawAttr === "string" ? rawAttr : pathDot,
        value: getFlagCurrent(actor),
        max: getEffectiveMax(actor),
      };
    }
  }
  return null;
}

/**
 * Do not assign `CONFIG.Actor.trackableAttributes[actorType]` for systems that rely on DataModels only:
 * core then skips schema-derived trackables and the Resources tab only lists CONFIG entries (see core
 * discussion around trackables + TypeDataModel). Append allowance paths on the merged result instead,
 * and resolve bar values for module flags in `getBarAttribute`.
 */
function installTokenDocumentAllowanceIntegration() {
  const TD = foundry.documents.TokenDocument;

  if (!TD.__movementAllowanceTrackedPatched) {
    TD.__movementAllowanceTrackedPatched = true;
    const origTracked = TD.getTrackedAttributes;
    TD.getTrackedAttributes = function movementAllowanceGetTrackedAttributes(data, path) {
      const desc = origTracked.call(TD, data, path);
      return mergeAllowanceIntoTrackedDescriptor(desc, data);
    };
  }

  if (!TD.__movementAllowanceChoicesPatched) {
    TD.__movementAllowanceChoicesPatched = true;
    const origChoices = TD.getTrackedAttributeChoices;
    TD.getTrackedAttributeChoices = function movementAllowanceGetTrackedAttributeChoices(attributes) {
      if (!attributes || typeof attributes !== "object") return origChoices.call(TD, attributes);
      const bar = finalizeBarDescriptorForAllowance(Array.isArray(attributes.bar) ? attributes.bar : [], {
        injectAllowanceCurrent: false,
      });
      const value = dedupeTrackableValueEntries(
        Array.isArray(attributes.value) ? attributes.value : []
      );
      return origChoices.call(TD, { ...attributes, bar, value });
    };
  }

  const proto = TD.prototype;
  if (!proto.__movementAllowanceBarPatched) {
    proto.__movementAllowanceBarPatched = true;
    const origBar = proto.getBarAttribute;
    proto.getBarAttribute = function movementAllowanceGetBarAttribute(barName, options) {
      const hit = tryMovementAllowanceBarAttribute(this, barName, options);
      if (hit) return hit;
      return origBar.call(this, barName, options);
    };
  }
}

/**
 * Systems that subclass `TokenDocument` and override static `getTrackedAttributes` without always calling
 * `super` (e.g. Genesys) never hit patches on the base class. Wrap `CONFIG.Token.documentClass` on ready.
 */
function installActiveTokenDocumentSubclassAllowanceIntegration() {
  const Base = foundry.documents.TokenDocument;
  const Cls = CONFIG.Token?.documentClass;
  if (!Cls || Cls === Base || Cls.__movementAllowanceSubclassIntegrated) return;
  Cls.__movementAllowanceSubclassIntegrated = true;

  const origStatic = Cls.getTrackedAttributes;
  Cls.getTrackedAttributes = function movementAllowanceSubclassGetTrackedAttributes(data, path) {
    const desc = origStatic.call(Cls, data, path);
    return mergeAllowanceIntoTrackedDescriptor(desc, data);
  };

  const origBar = Cls.prototype.getBarAttribute;
  Cls.prototype.getBarAttribute = function movementAllowanceSubclassGetBarAttribute(barName, options) {
    const hit = tryMovementAllowanceBarAttribute(this, barName, options);
    if (hit) return hit;
    return origBar.call(this, barName, options);
  };
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
    position: { width: 150, height: "auto" },
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

  installTokenDocumentAllowanceIntegration();
});

Hooks.once("ready", () => {
  installActiveTokenDocumentSubclassAllowanceIntegration();

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

    // ApplicationV2 TokenConfig: match native tab `data-group`, nav markup (`button` vs `a`), and panel
    // parent. Tabs are bound before this hook; unknown groups or wrong containers leave the panel hidden.
    const refPanel = root.querySelector(".tab[data-tab][data-group], .tab[data-tab]");
    const tabGroup = refPanel?.dataset?.group ?? root.querySelector("nav.tabs")?.dataset?.group ?? "primary";

    const tabNav =
      (tabGroup && root.querySelector(`nav.tabs[data-group="${CSS.escape(tabGroup)}"]`)) ||
      root.querySelector("nav.tabs") ||
      root.querySelector(".sheet-tabs[data-group]") ||
      root.querySelector(".sheet-tabs");

    const tabHost = refPanel?.parentElement;
    if (!tabNav || !tabHost) return;

    const refNavItem = tabNav?.querySelector("[data-tab]");
    const navTag = refNavItem?.tagName === "BUTTON" ? "button" : "a";
    const tabButton = document.createElement(navTag);
    if (navTag === "button") tabButton.type = "button";
    tabButton.className = refNavItem?.className?.length ? refNavItem.className : "item";
    tabButton.dataset.tab = TOKEN_CONFIG_TAB;
    tabButton.dataset.group = tabGroup;
    tabButton.innerHTML = `<i class="fas fa-person-running" aria-hidden="true"></i><span class="label">${localize("TabMovement")}</span>`;

    const tabBody = document.createElement(refPanel?.tagName?.toLowerCase() === "section" ? "section" : "div");
    tabBody.className = refPanel?.className?.length ? refPanel.className : "tab";
    if (!tabBody.classList.contains("tab")) tabBody.classList.add("tab");
    tabBody.dataset.tab = TOKEN_CONFIG_TAB;
    tabBody.dataset.group = tabGroup;
    tabBody.setAttribute("hidden", "");
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

    if (!tabNav.querySelector(`[data-tab="${TOKEN_CONFIG_TAB}"]`)) tabNav.appendChild(tabButton);

    if (!tabHost.querySelector(`.tab[data-tab="${TOKEN_CONFIG_TAB}"]`)) tabHost.appendChild(tabBody);

    // TokenConfig binds ApplicationV2 tabs before this hook; our tab id is not in the app manifest, so we
    // toggle this panel (and nav .active) ourselves after click. Foundry still handles native tabs.
    if (!tabNav.dataset.movementAllowanceTabSync) {
      tabNav.dataset.movementAllowanceTabSync = "1";
      const groupSel = CSS.escape(tabGroup);
      // Foundry's ApplicationV2 tab handling is async (`changeTab`). `queueMicrotask` runs before that
      // work finishes, so visibility can fight core and leave a native tab blank until the next tab change.
      // Defer with setTimeout(0) and coalesce rapid clicks so only the last intended tab wins.
      let tabSyncGeneration = 0;
      tabNav.addEventListener("click", (ev) => {
        const t = ev.target.closest("[data-tab]");
        if (!t || !tabNav.contains(t)) return;
        const id = t.dataset.tab;
        const gen = ++tabSyncGeneration;
        setTimeout(() => {
          if (gen !== tabSyncGeneration) return;
          if (id === TOKEN_CONFIG_TAB) {
            tabNav.querySelectorAll("[data-tab]").forEach((el) => el.classList.remove("active"));
            t.classList.add("active");
            tabHost.querySelectorAll(`.tab[data-group="${groupSel}"]`).forEach((p) => {
              const on = p.dataset.tab === TOKEN_CONFIG_TAB;
              p.classList.toggle("active", on);
              if (on) p.removeAttribute("hidden");
              else p.setAttribute("hidden", "");
            });
          } else {
            tabButton.classList.remove("active");
            tabBody.classList.remove("active");
            tabBody.setAttribute("hidden", "");
            const nativePanel = tabHost.querySelector(
              `.tab[data-group="${groupSel}"][data-tab="${CSS.escape(id)}"]`
            );
            if (nativePanel) nativePanel.removeAttribute("hidden");
          }
        }, 0);
      });
    }

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
