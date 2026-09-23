// Bodík v9.3.0 — authenticated WebSocket client for the Bodík integration.
import { LitElement, html, css } from "/local/lit-element.js";
import { defaultReasonCategories, entitlementView, filterReasonGroups, orderedCategories } from "./bodik-ui-utils.mjs";

const VERSION = "9.3.0";
const STYLESHEET_URL = new URL("./bodik-panel.css", import.meta.url).href;

class BodikPanel extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      appData: { type: Object, state: true },
      activeProfileId: { type: String, state: true },
      activeTab: { type: String, state: true },
      _availableUsers: { type: Array, state: true },
      _canManage: { type: Boolean, state: true },
      _celebratingDaily: { type: Boolean, state: true },
      _editingReasonIndex: { type: Number, state: true },
      _openReasonMenuId: { type: String, state: true },
      _error: { type: String, state: true },
      _haEntities: { type: Array, state: true },
      _historyLimit: { type: Number, state: true },
      _loading: { type: Boolean, state: true },
      _revision: { type: Number, state: true },
      _reasonSearch: { type: String, state: true },
      _saving: { type: Boolean, state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        min-height: calc(100vh - var(--header-height, 56px));
      }
    `;
  }

  constructor() {
    super();
    this.appData = { profiles: [], admin_user_ids: [] };
    this.activeProfileId = null;
    this.activeTab = "dashboard";
    this._availableUsers = [];
    this._canManage = false;
    this._celebratingDaily = false;
    this._editingReasonIndex = -1;
    this._openReasonMenuId = null;
    this._error = "";
    this._haEntities = [];
    this._historyLimit = 10;
    this._loading = true;
    this._revision = 0;
    this._reasonSearch = "";
    this._saving = false;
    this._dataLoaded = false;
    this._unsubscribeUpdates = null;
    this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
    this._boundReasonMenuOutside = this._handleReasonMenuOutside.bind(this);
    this._boundReasonMenuEscape = this._handleReasonMenuEscape.bind(this);
    this._loadSheetJS();
  }

  setConfig(config) {
    this.config = config || {};
  }

  getCardSize() {
    return 12;
  }

  get profiles() {
    return this.appData?.profiles || [];
  }

  get activeProfile() {
    return this.profiles.find((profile) => profile.id === this.activeProfileId) || null;
  }

  get score() {
    return Number(this.activeProfile?.score ?? 0);
  }

  get reasons() {
    return this.activeProfile?.reasons || [];
  }

  get history() {
    return this.activeProfile?.history || [];
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._boundVisibilityChange);
    document.addEventListener("pointerdown", this._boundReasonMenuOutside);
    document.addEventListener("focusin", this._boundReasonMenuOutside);
    document.addEventListener("keydown", this._boundReasonMenuEscape);
    this._refreshInterval = window.setInterval(() => {
      if (!document.hidden) this._loadAllData({ silent: true });
    }, 600000);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._boundVisibilityChange);
    document.removeEventListener("pointerdown", this._boundReasonMenuOutside);
    document.removeEventListener("focusin", this._boundReasonMenuOutside);
    document.removeEventListener("keydown", this._boundReasonMenuEscape);
    if (this._refreshInterval) window.clearInterval(this._refreshInterval);
    if (this._celebrationTimer) window.clearTimeout(this._celebrationTimer);
    if (this._unsubscribeUpdates) {
      this._unsubscribeUpdates();
      this._unsubscribeUpdates = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (changedProperties.has("hass") && this.hass) this._onHassReady();
  }

  shouldUpdate(changedProperties) {
    if (!changedProperties.has("hass")) return true;
    const oldHass = changedProperties.get("hass");
    if (!oldHass || !this.hass) return true;
    const entityId = this.activeProfile?.scoreEntity;
    if (entityId && oldHass.states?.[entityId] !== this.hass.states?.[entityId]) return true;
    return oldHass.user?.id !== this.hass.user?.id;
  }

  _onHassReady() {
    this._haEntities = Object.keys(this.hass.states || {})
      .filter((entityId) => entityId.startsWith("input_number."))
      .sort((a, b) => a.localeCompare(b, "cs"));
    if (!this._dataLoaded) {
      this._dataLoaded = true;
      this._loadAllData();
    }
    this._subscribeToUpdates();
  }

  async _subscribeToUpdates() {
    if (this._unsubscribeUpdates || !this.hass?.connection) return;
    try {
      this._unsubscribeUpdates = await this.hass.connection.subscribeEvents(
        () => this._loadAllData({ silent: true }),
        "bodik_updated",
      );
    } catch (error) {
      console.warn("Bodík: odběr aktualizací se nezdařil", error);
    }
  }

  _handleVisibilityChange() {
    if (!document.hidden) this._loadAllData({ silent: true });
  }

  _loadSheetJS() {
    if (document.getElementById("bodik-sheetjs")) return;
    const script = document.createElement("script");
    script.id = "bodik-sheetjs";
    script.src = "/local/xlsx.full.min.js";
    script.async = true;
    document.head.appendChild(script);
  }

  async _loadAllData({ silent = false } = {}) {
    if (!this.hass?.callWS) return;
    if (!silent) this._loading = true;
    try {
      const response = await this.hass.callWS({ type: "bodik/get" });
      const previousActive = this.activeProfileId;
      const previousProfile = this.activeProfile;
      const wasDailyComplete = previousProfile?.periodic_status?.daily
        ? previousProfile.periodic_status.daily.points >= previousProfile.periodic_status.daily.target
        : null;
      this.appData = response.data || { profiles: [], admin_user_ids: [] };
      this._revision = response.revision || this.appData.revision || 0;
      this._canManage = response.can_manage === true;
      this._availableUsers = response.available_users || [];
      this.activeProfileId = this.profiles.some((item) => item.id === previousActive)
        ? previousActive
        : this.profiles[0]?.id || null;
      const currentDaily = this.activeProfile?.periodic_status?.daily;
      const isDailyComplete = currentDaily
        ? currentDaily.points >= currentDaily.target
        : false;
      if (wasDailyComplete === false && isDailyComplete) this._startDailyCelebration();
      if (!this._canManage && this.activeTab === "settings") this.activeTab = "dashboard";
      this._error = "";
    } catch (error) {
      this._error = this._errorMessage(error, "Backend Bodíku není dostupný.");
      console.error("Bodík: načtení dat selhalo", error);
    } finally {
      this._loading = false;
    }
  }

  _startDailyCelebration() {
    this._celebratingDaily = true;
    if (this._celebrationTimer) window.clearTimeout(this._celebrationTimer);
    this._celebrationTimer = window.setTimeout(() => {
      this._celebratingDaily = false;
      this._celebrationTimer = null;
    }, 1300);
  }

  _errorMessage(error, fallback) {
    return error?.message || error?.error?.message || fallback;
  }

  _cloneData() {
    return typeof structuredClone === "function"
      ? structuredClone(this.appData)
      : JSON.parse(JSON.stringify(this.appData));
  }

  async _saveConfig(successMessage = "Změny byly uloženy") {
    if (!this._canManage || this._saving) return false;
    this._saving = true;
    try {
      const response = await this.hass.callWS({
        type: "bodik/save_config",
        revision: this._revision,
        data: {
          profiles: this.profiles,
          admin_user_ids: this.appData.admin_user_ids || [],
        },
      });
      this._revision = response.revision;
      await this._loadAllData({ silent: true });
      this._showToast(successMessage);
      return true;
    } catch (error) {
      const message = this._errorMessage(error, "Uložení se nezdařilo.");
      if (error?.code === "conflict" || message.toLowerCase().includes("mezitím")) {
        await this._loadAllData({ silent: true });
        this._showToast("Data změnil jiný panel. Načetl jsem aktuální verzi; zopakujte změnu.", true, 7000);
      } else {
        this._showToast(message, true, 7000);
      }
      return false;
    } finally {
      this._saving = false;
    }
  }

  render() {
    const compact = this.config?.compact === true;
    const theme = this.activeProfile?.theme || "auto";
    this.setAttribute("theme", theme);

    return html`
      <link rel="stylesheet" href=${STYLESHEET_URL} />
      <div id="toast-notifications" role="status" aria-live="polite"></div>
      <main class="wrap ${compact ? "compact" : ""}">
        ${this._loading && !this.profiles.length
          ? html`<section class="card state-card"><div class="spinner" aria-hidden="true"></div><p>Načítám Bodík…</p></section>`
          : this._error
            ? this._renderError()
            : this._renderContent(compact)}
      </main>
    `;
  }

  _renderError() {
    return html`
      <section class="card state-card error-state">
        <h1>Bodík se nepodařilo načíst</h1>
        <p>${this._error}</p>
        <button class="btn" @click=${() => this._loadAllData()}>Zkusit znovu</button>
      </section>
    `;
  }

  _renderContent(compact) {
    return html`
      <header class="head">
        ${!compact
          ? html`
              ${this.activeProfile?.childPhotoUrl
                ? html`<img class="child-photo" src=${this.activeProfile.childPhotoUrl} alt="Profilová fotografie ${this.activeProfile.name}" />`
                : html`<div class="child-photo placeholder" aria-hidden="true">🏆</div>`}
              <div class="title">
                <h1>Bodík <span class="version">v${VERSION}</span></h1>
                <div class="muted">Rodinný bodovací systém</div>
              </div>
            `
          : ""}

        <section class="profile-panel" aria-label="Aktivní profil a přepínání profilů">
          ${!compact && this.activeProfile
            ? html`
                <div class="profile-overview">
                  <span class="profile-eyebrow">Aktivní profil</span>
                  <strong class="profile-name">${this.activeProfile.name}</strong>
                </div>
              `
            : ""}
          <div class="profile-choices">
            ${!compact ? html`<span class="profile-eyebrow">Přepnout profil</span>` : ""}
            <nav class="profile-switcher" aria-label="Výběr profilu">
              ${this.profiles.map(
                (profile) => html`
                  <button
                    class="profile-btn ${profile.id === this.activeProfileId ? "active" : ""}"
                    data-profile-id=${profile.id}
                    aria-pressed=${profile.id === this.activeProfileId ? "true" : "false"}
                    @click=${this._switchProfile}
                  >
                    ${profile.name}
                  </button>
                `,
              )}
            </nav>
          </div>
        </section>

        ${!compact
          ? html`
              <div class="head-right">
                <nav class="tabs" aria-label="Sekce Bodíku">
                  <button class="tab ${this.activeTab === "dashboard" ? "active" : ""}" @click=${() => (this.activeTab = "dashboard")}>Přehled</button>
                  ${this._canManage
                    ? html`<button class="tab ${this.activeTab === "settings" ? "active" : ""}" @click=${() => (this.activeTab = "settings")}>Nastavení</button>`
                    : ""}
                </nav>
                <span class="badge">${this.hass?.user?.name || "Uživatel"}</span>
              </div>
            `
          : ""}
      </header>

      ${this.activeProfile
        ? html`
            ${this.activeTab === "dashboard" ? this._renderDashboard() : ""}
            ${this.activeTab === "settings" && this._canManage ? this._renderSettings() : ""}
          `
        : html`
            <section class="card state-card">
              <h2>Žádný profil</h2>
              <p>Administrátor musí vytvořit alespoň jeden profil.</p>
            </section>
          `}

      ${!compact
        ? html`<footer class="muted small center">Bodík v${VERSION} · zabezpečený backend · revize ${this._revision}</footer>`
        : ""}
    `;
  }

  _renderDashboard() {
    const visibleHistory = [...this.history].reverse().slice(0, this._historyLimit);
    return html`
      ${this._renderPeriodicDashboard()}
      ${this._renderEntitlements()}

      <section class="card long-term-summary">
        <div><h2>Historické / dlouhodobé skóre: ${this.score}</h2><p class="note">Nemění denní, týdenní ani měsíční výkon.</p></div>
      </section>

      <section class="card rules-card">
        <h2>Aktuální pravidla</h2>
        <div class="rules-text generated-rules">${this.activeProfile.generated_rules || "Pravidla nejsou dostupná."}</div>
        ${this.activeProfile.rules
          ? html`<h3>Další rodinná pravidla</h3><div class="rules-text">${this.activeProfile.rules}</div>`
          : ""}
      </section>

      ${this._canManage ? this._renderQuickActions() : ""}

      <section class="card">
        <h2>Rychlé důvody</h2>
        ${!this._canManage ? html`<p class="note">Body mohou měnit pouze rodiče.</p>` : ""}
        <label class="reason-search">
          <span class="sr-only">Hledat důvod</span>
          <input type="search" placeholder="Hledat důvod…" .value=${this._reasonSearch} @input=${this._updateReasonSearch} @keydown=${this._reasonSearchKeydown} />
        </label>
        ${this.reasons.length
          ? this._renderReasonGroups()
          : html`<p class="muted">Nejsou nastavené žádné rychlé důvody.</p>`}
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <h2>Historie</h2>
            <span class="muted small">${this.history.length} záznamů</span>
          </div>
          <div class="row gap">
            <button class="btn ghost" @click=${this._downloadXLSX}>Export XLSX</button>
            <button class="btn ghost" @click=${() => this._loadAllData()}>Obnovit</button>
            ${this._canManage ? html`<button class="btn danger" @click=${this._clearHistory}>Vyčistit</button>` : ""}
          </div>
        </div>
        <div class="history-list">
          ${visibleHistory.length
            ? visibleHistory.map(
                (entry) => html`
                  <article class="history-entry">
                    <div class="history-main">
                      <strong>${entry.desc}</strong>
                      <span class="history-delta ${entry.delta >= 0 ? "positive" : "negative"}">${entry.delta >= 0 ? "+" : ""}${entry.delta}</span>
                    </div>
                    <div class="muted small">${this._fmt(entry.time)} · ${entry.user || "Neznámý"} · ${entry.prev} → ${entry.next}</div>
                  </article>
                `,
              )
            : html`<p class="muted">Historie je prázdná. Aktuální skóre zůstává zachováno.</p>`}
        </div>
        ${visibleHistory.length < this.history.length
          ? html`<button class="btn ghost load-more" @click=${() => (this._historyLimit += 20)}>Načíst starší</button>`
          : ""}
      </section>
    `;
  }

  _renderReasonGroups() {
    const groups = filterReasonGroups(
      this.reasons,
      this.activeProfile.reason_categories || [],
      this._reasonSearch,
    );
    if (!groups.length) return html`<p class="muted empty-reasons">Žádný důvod neodpovídá hledání.</p>`;
    return html`<div class="reason-groups">
      ${groups.map(({ category, reasons }) => html`<section class="reason-group">
          <h3>${category.name}</h3>
          <div class="reasons">
            ${reasons.map((reason) => {
              const status = this.activeProfile.reason_status?.reasons?.[reason.id];
              return html`<button class="reason" .reason=${reason} title=${status?.message || ""} @click=${this._applyReason} ?disabled=${!this._canManage || this._saving || status?.available === false}>
                <span class="name">${reason.name}${status?.limit ? html`<small>${status.used_today}/${status.limit} dnes</small>` : ""}${status && !status.available ? html`<small class="negative">${status.message}</small>` : ""}</span>
                <span class="pts ${reason.value >= 0 ? "positive" : "negative"}">${reason.value >= 0 ? "+" : ""}${reason.value}</span>
              </button>`;
            })}
          </div>
        </section>`)}
    </div>`;
  }

  _updateReasonSearch(event) {
    this._reasonSearch = event.currentTarget.value;
  }

  _reasonSearchKeydown(event) {
    if (event.key === "Escape") {
      event.currentTarget.value = "";
      this._reasonSearch = "";
    }
  }

  _progressWidth(points, target, cap = 100) {
    if (!target) return 0;
    return Math.max(0, Math.min(cap, (Number(points) / Number(target)) * 100));
  }

  _renderPeriodicDashboard() {
    const status = this.activeProfile?.periodic_status;
    const config = this.activeProfile?.periodic_config;
    if (!status || !config) return "";
    const daily = status.daily;
    const weekly = status.weekly;
    const monthly = status.monthly;
    const monthlyCap = Number(config.max_payout_percent || 150);
    return html`
      <section class="card periodic-card">
        <div class="section-head">
          <div><h2>Průběžný výkon</h2><span class="muted small">Výkon se počítá odděleně od dlouhodobého skóre</span></div>
        </div>
        <article class="periodic-goal daily-goal ${daily.remaining ? "" : "completed"} ${this._celebratingDaily ? "celebrating" : ""}">
          <div class="periodic-heading"><div><span class="periodic-kicker">Dnes</span><strong>${daily.points} / ${daily.target} bodů</strong></div><span>${daily.remaining ? `Zbývá ${daily.remaining} b.` : "✓ Denní cíl splněn"}</span></div>
          <div class="progress"><span style=${`width:${this._progressWidth(daily.points, daily.target)}%`}></span></div>
        </article>
        <div class="periodic-secondary">
          <article class="periodic-goal">
            <div class="periodic-heading"><div><span class="periodic-kicker">Tento týden</span><strong>${weekly.points} / ${weekly.target}</strong></div></div>
            <div class="progress weekly"><span style=${`width:${this._progressWidth(weekly.points, weekly.target)}%`}></span></div>
            <div class="periodic-details single">
              ${weekly.previous_result
                ? html`<span>Minulý uzavřený týden: <strong>${weekly.previous_result.points} / ${weekly.previous_result.target}</strong>${weekly.previous_result.initial_partial ? " · úvodní částečné období" : ""}</span>`
                : html`<span class="muted">První týden ještě nebyl uzavřen.</span>`}
            </div>
          </article>
          <article class="periodic-goal">
            <div class="periodic-heading"><div><span class="periodic-kicker">Tento měsíc</span><strong>${monthly.points} / ${monthly.target} · ${monthly.estimated_allowance.completion_percent}%</strong></div></div>
            <div class="progress monthly"><span style=${`width:${this._progressWidth(monthly.points, monthly.target, monthlyCap) / monthlyCap * 100}%`}></span></div>
            <div class="periodic-details single"><span>Odhad kapesného: <strong>${monthly.estimated_allowance.amount} Kč</strong> (${monthly.estimated_allowance.payout_percent} %)</span></div>
            ${monthly.estimated_allowance.amount === 0 && monthly.first_paying_threshold
              ? html`<small class="allowance-threshold">První kapesné od ${monthly.first_paying_threshold.minimum_percent} % (${monthly.first_paying_threshold.points} bodů). Chybí ${monthly.first_paying_threshold.points_remaining} bodů.</small>`
              : ""}
          </article>
        </div>
      </section>
    `;
  }

  _renderEntitlements() {
    const status = this.activeProfile?.periodic_status;
    const config = this.activeProfile?.periodic_config;
    if (!status || !config) return "";
    const entitlement = entitlementView(status, config);
    const weeklyReward = entitlement.weeklyReward;
    const weeklyConfigured = config.weekly_reward?.enabled === true;
    return html`
      <section class="card entitlement-card">
        <div class="section-head"><div><h2>Aktuálně odemčeno</h2><span class="muted small">Nároky z periodického systému</span></div></div>
        <div class="entitlement-grid">
          <article class="entitlement-item active">
            <span class="periodic-kicker">Dnes odemčeno</span>
            <strong>${entitlement.todayMinutes} min digitálního času</strong>
            <small>Platí dnes podle předchozího uzavřeného dne.</small>
          </article>
          <article class="entitlement-item ${entitlement.tomorrowUnlocked ? "earned" : "pending"}">
            <span class="periodic-kicker">${entitlement.tomorrowUnlocked ? "Na zítřek odemčeno" : "Na zítřek zatím neodemčeno"}</span>
            ${entitlement.tomorrowUnlocked
              ? html`<strong>${entitlement.tomorrowMinutes} min</strong>${entitlement.canGrowTomorrow ? html`<small>Další +${config.bonus_step_minutes} min za ${entitlement.pointsToNextBonus} bodů.</small>` : html`<small>Dosaženo denní maximum.</small>`}`
              : html`<strong>Chybí ${entitlement.missingPoints} bodů</strong><small>Počítá se dnešní průběžný výkon.</small>`}
          </article>
          ${weeklyConfigured
            ? html`<article class="entitlement-item ${weeklyReward?.unlocked ? "earned" : "pending"}">
                <span class="periodic-kicker">Týdenní odměna</span>
                <strong>${weeklyReward?.unlocked ? "✓ Odemčeno" : "Zatím neodemčeno"}</strong>
                <small>${weeklyReward?.label || config.weekly_reward.label}${weeklyReward?.description || config.weekly_reward.description ? ` · ${weeklyReward?.description || config.weekly_reward.description}` : ""}</small>
              </article>`
            : ""}
          <article class="entitlement-item estimate">
            <span class="periodic-kicker">Odhad kapesného</span>
            <strong>${entitlement.monthlyEstimate.amount} Kč</strong>
            <small>Průběžný odhad za aktuální měsíc.${entitlement.previousMonthlyResult ? ` Poslední uzávěra: ${entitlement.previousMonthlyResult.amount} Kč.` : ""}</small>
          </article>
        </div>
      </section>
    `;
  }

  _renderQuickActions() {
    return html`
      <section class="card">
        <h2>Rychlé změny výkonu</h2>
        <p class="note">Tyto bodové změny se počítají do denního, týdenního a měsíčního výkonu.</p>
        <div class="quick-actions">
          <div class="quick-buttons">
            ${[-5, -1, 1, 5].map(
              (delta) => html`<button class="btn" data-delta=${delta} @click=${this._applyDelta} ?disabled=${this._saving}>${delta > 0 ? "+" : ""}${delta}</button>`,
            )}
          </div>
          <div class="form-row custom-change">
            <label class="sr-only" for="custom-reason">Důvod vlastní změny</label>
            <input id="custom-reason" maxlength="250" placeholder="Důvod změny" />
            <label class="sr-only" for="custom-delta">Počet bodů</label>
            <input id="custom-delta" type="number" step="1" placeholder="± body" />
            <button class="btn" @click=${this._applyCustomDelta} ?disabled=${this._saving}>Použít</button>
          </div>
        </div>
      </section>
    `;
  }

  _renderSettings() {
    return html`
      <details class="card settings-section" open>
        <summary class="settings-section-header">
          <h2>Oprávnění rodičů</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <p class="note">Administrátoři Home Assistantu mají přístup vždy. Zde lze přidat další aktivní uživatele podle jejich stabilního HA ID.</p>
          <div class="user-list">
            ${this._availableUsers.map((user) => {
              const granted = user.is_admin || (this.appData.admin_user_ids || []).includes(user.id);
              return html`
                <label class="user-row">
                  <input type="checkbox" data-user-id=${user.id} .checked=${granted} ?disabled=${user.is_admin || this._saving} @change=${this._toggleManagerUser} />
                  <span>${user.name}</span>
                  ${user.is_admin ? html`<span class="badge">HA administrátor</span>` : ""}
                </label>
              `;
            })}
          </div>
        </div>
      </details>

      <details class="card settings-section" open>
        <summary class="settings-section-header">
          <h2>Profily</h2>
          <button class="btn" @click=${(e) => { e.preventDefault(); this._addProfile(); }} ?disabled=${this._saving}>Přidat profil</button>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <div class="profile-manager">
            ${this.profiles.map((profile) => this._renderProfileEditor(profile))}
          </div>
        </div>
      </details>

      <details class="card settings-section" open>
        <summary class="settings-section-header">
          <h2>Další rodinná pravidla · ${this.activeProfile.name}</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <p class="note">Volitelné poznámky doplňují automaticky generovaná aktuální pravidla.</p>
          <label for="rules-input">Text dalších pravidel</label>
          <textarea id="rules-input" class="rules-editor" maxlength="5000" .value=${this.activeProfile.rules || ""}></textarea>
          <button class="btn" @click=${this._saveRules} ?disabled=${this._saving}>Uložit pravidla</button>
        </div>
      </details>

      ${this._renderReasonSettings()}
      ${this._renderPeriodicSettings()}
      ${this._renderPeriodResetSettings()}

      <details class="card settings-section">
        <summary class="settings-section-header">
          <h2>Administrativní dlouhodobé skóre · ${this.activeProfile.name}</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <p class="note">Tato operace nemění dnešní, týdenní ani měsíční výkon a neovlivní kapesné.</p>
          <div class="form-row set-score">
            <label class="sr-only" for="set-value">Nové dlouhodobé skóre</label>
            <input id="set-value" type="number" step="1" placeholder="Nastavit na…" />
            <button class="btn ghost" @click=${this._applySetValue} ?disabled=${this._saving}>Nastavit dlouhodobé skóre</button>
            <button class="btn danger" @click=${() => this._setScore(0, "Vynulování dlouhodobého skóre")} ?disabled=${this._saving}>Vynulovat dlouhodobé skóre</button>
          </div>
        </div>
      </details>

      <details class="card settings-section" open>
        <summary class="settings-section-header">
          <h2>Záloha a obnova</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <p class="note">
            Kompletní JSON záloha obsahuje profily, skóre, pravidla, důvody, kategorie,
            oprávnění a historii. Soubory fotografií ani definice pomocníků
            <code>input_number</code> součástí zálohy nejsou.
          </p>
          <div class="backup-actions">
            <button class="btn" @click=${this._downloadBackup} ?disabled=${this._saving || !this.profiles.length}>
              Exportovat zálohu
            </button>
            <label class="btn ghost backup-file-button ${this._saving ? "disabled" : ""}">
              Importovat zálohu
              <input
                type="file"
                accept=".json,application/json"
                @change=${this._importBackup}
                ?disabled=${this._saving}
              />
            </label>
          </div>
          <p class="note small">Import nahradí všechna současná nastavení, skóre a historii obsahem vybrané zálohy.</p>
        </div>
      </details>

      <details class="card settings-section" open>
        <summary class="settings-section-header">
          <h2>Diagnostika</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
          <div class="diagnostics">
            <div><span>Backend</span><strong>Připojen</strong></div>
            <div><span>Revize dat</span><strong>${this._revision}</strong></div>
            <div><span>Profily</span><strong>${this.profiles.length}</strong></div>
            <div><span>Zrcadlo skóre</span><strong>${this.activeProfile.scoreEntity || "nenastaveno"}</strong></div>
            <div><span>Historie</span><strong>${this.history.length} záznamů</strong></div>
          </div>
          <button class="btn ghost" @click=${() => this._loadAllData()}>Otestovat spojení</button>
        </div>
      </details>
    `;
  }

  _renderPeriodicSettings() {
    const cfg = this.activeProfile.periodic_config || {};
    const reward = cfg.weekly_reward || {};
    const bands = cfg.payout_bands || [];
    return html`
      <details class="card settings-section periodic-settings" open>
        <summary class="settings-section-header">
          <h2>Periodické cíle · ${this.activeProfile.name}</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
        <p class="note">Každý profil má vlastní nastavení. Změna dne nebo času týdenní uzávěry bezpečně zahájí nové částečné období.</p>
        <h3>Denní cíl a digitální čas</h3>
        <div class="settings-grid">
          <label>Denní cíl<input id="periodic-daily-target" type="number" min="1" step="1" .value=${cfg.daily_target} /></label>
          <label>Základní minuty<input id="periodic-base-minutes" type="number" min="0" step="1" .value=${cfg.base_digital_minutes} /></label>
          <label>Bonusový krok v bodech<input id="periodic-step-points" type="number" min="1" step="1" .value=${cfg.bonus_step_points} /></label>
          <label>Minuty za bonusový krok<input id="periodic-step-minutes" type="number" min="0" step="1" .value=${cfg.bonus_step_minutes} /></label>
          <label>Maximum minut<input id="periodic-max-minutes" type="number" min="0" step="1" .value=${cfg.max_digital_minutes} /></label>
        </div>
        <h3>Týdenní cíl a odměna</h3>
        <div class="settings-grid">
          <label>Týdenní cíl<input id="periodic-weekly-target" type="number" min="1" step="1" .value=${cfg.weekly_target} /></label>
          <label>Den uzávěry<select id="periodic-weekday">${["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"].map((name, index) => html`<option value=${index} ?selected=${Number(cfg.weekly_tick_weekday) === index}>${name}</option>`)}</select></label>
          <label>Čas uzávěry<input id="periodic-week-time" type="time" .value=${cfg.weekly_tick_time || "17:00"} /></label>
          <label class="checkbox-field"><input id="periodic-reward-enabled" type="checkbox" .checked=${reward.enabled === true} /> Odměna zapnutá</label>
          <label>Název odměny<input id="periodic-reward-label" maxlength="120" .value=${reward.label || ""} /></label>
          <label class="wide">Popis odměny<input id="periodic-reward-description" maxlength="500" .value=${reward.description || ""} /></label>
        </div>
        <h3>Měsíční cíl a kapesné</h3>
        <div class="settings-grid">
          <label>Měsíční cíl<input id="periodic-monthly-target" type="number" min="1" step="1" .value=${cfg.monthly_target} /></label>
          <label>Kapesné při 100 % (Kč)<input id="periodic-allowance" type="number" min="0" step="1" .value=${cfg.allowance_at_100} /></label>
          <label>Maximum výplaty (%)<input id="periodic-max-payout" type="number" min="100" step="1" .value=${cfg.max_payout_percent} /></label>
        </div>
        <div class="payout-bands">
          <div class="section-head"><strong>Výplatní pásma do 100 %</strong><button class="btn ghost small-btn" @click=${this._addPayoutBand}>Přidat pásmo</button></div>
          ${bands.map((band, index) => html`
            <div class="band-row" data-band-index=${index}>
              <label>Od výkonu %<input class="band-min" type="number" min="0" max="100" .value=${band.minimum_percent} /></label>
              <label>Vyplatit %<input class="band-payout" type="number" min="0" max="100" .value=${band.payout_percent} /></label>
              <button class="btn danger small-btn" @click=${() => this._deletePayoutBand(index)} ?disabled=${band.minimum_percent === 0 || band.minimum_percent === 100}>Odebrat</button>
            </div>`)}
        </div>
        <button class="btn" @click=${this._savePeriodicSettings} ?disabled=${this._saving}>Uložit periodické cíle</button>
        </div>
      </details>
    `;
  }

  _renderPeriodResetSettings() {
    const profile = this.activeProfile;
    const schedule = profile.periodic_schedule || {};
    const weekday = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"][Number(profile.periodic_config?.weekly_tick_weekday)] || "nastavený den";
    const next = (stamp) => stamp ? new Date(stamp).toLocaleString("cs-CZ", { timeZone: schedule.time_zone || "UTC" }) : "nezjištěno";
    return html`
      <details class="card settings-section">
        <summary class="settings-section-header"><h2>Administrativní reset bodů · ${profile.name}</h2><span class="chevron" aria-hidden="true"></span></summary>
        <div class="settings-section-body">
          <p><strong>Profil: ${profile.name}</strong></p>
          <p class="note">Reset se týká jen aktuálního období profilu ${profile.name}. Historie transakcí, uzavřené výsledky, již přiznaný digitální čas a týdenní odměna zůstanou zachovány. Další body se začnou počítat od resetu.</p>
          <p class="note small">Automatické uzávěry (${schedule.time_zone || "místní čas HA"}): denně v 00:00 (nejbližší ${next(schedule.daily)}); týdně ${weekday} v ${profile.periodic_config?.weekly_tick_time || "17:00"} (nejbližší ${next(schedule.weekly)}); měsíčně 1. den v 00:00 (nejbližší ${next(schedule.monthly)}). Ruční reset tyto termíny neposouvá.</p>
          <div class="backup-actions">
            <button class="btn ghost" @click=${() => this._resetPeriod("daily")} ?disabled=${this._saving}>Resetovat dnešní výkon</button>
            <button class="btn ghost" @click=${() => this._resetPeriod("weekly")} ?disabled=${this._saving}>Resetovat týdenní výkon</button>
            <button class="btn ghost" @click=${() => this._resetPeriod("monthly")} ?disabled=${this._saving}>Resetovat měsíční výkon</button>
          </div>
          <p class="note small">Úplný reset navíc vynuluje dlouhodobé skóre. Ostatní nastavení profilu zůstanou zachována.</p>
          <button class="btn danger" @click=${() => this._resetPeriod("all")} ?disabled=${this._saving}>Úplný reset skóre a aktuálního výkonu</button>
        </div>
      </details>
    `;
  }

  async _addPayoutBand() {
    const current = this._periodicConfigFromForm();
    const used = new Set(current.payout_bands.map((band) => Number(band.minimum_percent)));
    const minimum = [25, 10, 20, 30, 40, 60, 80, 90].find((value) => !used.has(value));
    if (minimum === undefined) return this._showToast("Nejprve upravte nebo odeberte některé pásmo.", true);
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.periodic_config = current;
    profile.periodic_config.payout_bands.push({ minimum_percent: minimum, payout_percent: minimum });
    profile.periodic_config.payout_bands.sort((a, b) => a.minimum_percent - b.minimum_percent);
    this.appData = data;
  }

  _deletePayoutBand(index) {
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.periodic_config = this._periodicConfigFromForm();
    profile.periodic_config.payout_bands.splice(index, 1);
    this.appData = data;
  }

  _periodicConfigFromForm() {
    const root = this.shadowRoot;
    const integer = (selector) => Number(root.querySelector(selector)?.value);
    const bands = [...root.querySelectorAll(".band-row")].map((row) => ({
      minimum_percent: Number(row.querySelector(".band-min").value),
      payout_percent: Number(row.querySelector(".band-payout").value),
    }));
    return {
      daily_target: integer("#periodic-daily-target"), base_digital_minutes: integer("#periodic-base-minutes"),
      bonus_step_points: integer("#periodic-step-points"), bonus_step_minutes: integer("#periodic-step-minutes"),
      max_digital_minutes: integer("#periodic-max-minutes"), weekly_target: integer("#periodic-weekly-target"),
      weekly_tick_weekday: integer("#periodic-weekday"), weekly_tick_time: root.querySelector("#periodic-week-time").value,
      weekly_reward: { enabled: root.querySelector("#periodic-reward-enabled").checked,
        label: root.querySelector("#periodic-reward-label").value.trim(),
        description: root.querySelector("#periodic-reward-description").value.trim() },
      monthly_target: integer("#periodic-monthly-target"), allowance_at_100: integer("#periodic-allowance"),
      payout_bands: bands, max_payout_percent: integer("#periodic-max-payout"),
    };
  }

  async _savePeriodicSettings() {
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.periodic_config = this._periodicConfigFromForm();
    this.appData = data;
    await this._saveConfig("Periodické cíle byly uloženy");
  }

  _renderProfileEditor(profile) {
    return html`
      <article class="profile-item" data-profile-id=${profile.id}>
        <label>Jméno<input class="profile-name" maxlength="80" .value=${profile.name} /></label>
        <label>Entita bodů
          <select class="profile-entity">
            <option value="">Bez zrcadla v input_number</option>
            ${this._haEntities.map((entityId) => html`<option value=${entityId} ?selected=${profile.scoreEntity === entityId}>${this.hass.states[entityId]?.attributes?.friendly_name || entityId} · ${entityId}</option>`)}
          </select>
        </label>
        <label>Motiv
          <select class="profile-theme">
            <option value="auto" ?selected=${(profile.theme || "auto") === "auto"}>Podle Home Assistantu</option>
            <option value="dark" ?selected=${profile.theme === "dark"}>Tmavý</option>
            <option value="light" ?selected=${profile.theme === "light"}>Světlý</option>
          </select>
        </label>
        <label>Fotografie<input class="profile-photo" maxlength="1000" .value=${profile.childPhotoUrl || ""} placeholder="/local/fotografie.png" /></label>
        <div class="item-actions">
          <button class="btn ghost" @click=${this._saveProfileChanges} ?disabled=${this._saving}>Uložit</button>
          <button class="btn danger" @click=${this._deleteProfile} ?disabled=${this._saving || this.profiles.length <= 1}>Smazat</button>
        </div>
      </article>
    `;
  }

  _renderReasonSettings() {
    const categories = orderedCategories(this.activeProfile.reason_categories || []);
    const groups = [
      ...categories.map((category) => ({
        category,
        reasons: this.reasons.map((reason, index) => ({ reason, index })).filter(({ reason }) => reason.category === category.id),
      })),
      {
        category: { id: "", name: "Bez kategorie", order: Number.MAX_SAFE_INTEGER },
        reasons: this.reasons.map((reason, index) => ({ reason, index })).filter(({ reason }) => !reason.category),
      },
    ];
    return html`
      <details class="card settings-section reason-settings-section" open>
        <summary class="settings-section-header">
          <h2>Důvody · ${this.activeProfile.name}</h2>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="settings-section-body">
        <div class="offline-cap-row">
          <label>Denní strop kladných Offline bodů<input id="offline-daily-cap" type="number" min="1" step="1" .value=${this.activeProfile.offline_daily_cap ?? ""} placeholder="Bez stropu" /></label>
          <button class="btn ghost" @click=${this._saveOfflineCap} ?disabled=${this._saving}>Uložit Offline strop</button>
          <span class="muted small">Dnes: ${this.activeProfile.reason_status?.offline_points_today || 0} / ${this.activeProfile.offline_daily_cap ?? "∞"} b.</span>
        </div>

        <div class="category-manager">
          <div class="section-head"><div><h3>Kategorie</h3><span class="muted small">ID kategorie zůstává stabilní; mění se jen název a pořadí.</span></div></div>
          <div class="category-list">
            ${categories.map((category) => html`
              <div class="category-row" data-category-id=${category.id}>
                <code>${category.id}</code>
                <label>Název<input class="category-name" maxlength="80" .value=${category.name} /></label>
                <label>Pořadí<input class="category-order" type="number" step="1" .value=${category.order} /></label>
                <button class="btn danger small-btn" @click=${() => this._deleteCategory(category.id)} ?disabled=${this._saving || category.id === "offline"} title=${category.id === "offline" ? "Offline je chráněná sémantická kategorie" : ""}>Smazat</button>
              </div>`)}
          </div>
          <div class="category-add">
            <label>Nová kategorie<input id="category-name-new" maxlength="80" placeholder="Název kategorie" /></label>
            <button class="btn ghost align-end" @click=${this._addCategory} ?disabled=${this._saving}>Přidat kategorii</button>
            <button class="btn align-end" @click=${this._saveCategories} ?disabled=${this._saving}>Uložit názvy a pořadí</button>
          </div>
        </div>

        <div class="reason-form">
          <label class="grow">Název<input id="reason-name" maxlength="120" /></label>
          <label class="number-field">Body<input id="reason-points" type="number" step="1" /></label>
          <label>Kategorie<select id="reason-category">${this._reasonCategoryOptions("")}</select></label>
          <label>Max. použití za den<input id="reason-limit" type="number" min="1" step="1" placeholder="Bez limitu" /></label>
          <button class="btn align-end" @click=${this._addReason} ?disabled=${this._saving}>Přidat</button>
        </div>
        <div class="reason-settings-groups">
          ${groups.map(({ category, reasons }) => html`
            <details class="reason-settings-group" ?open=${reasons.length > 0}>
              <summary><span>${category.name}</span><span class="badge">${reasons.length}</span></summary>
              <div class="category-reason-actions"><button class="btn ghost small-btn" @click=${() => this._prepareReasonForCategory(category.id)}>Přidat důvod</button></div>
              <div class="manage-grid">
                ${reasons.length ? reasons.map(({ reason, index }) => this._renderReasonEditor(reason, index)) : html`<p class="muted">Kategorie zatím nemá žádné důvody.</p>`}
              </div>
            </details>`)}
        </div>
        </div>
      </details>
    `;
  }

  _renderReasonEditor(reason, index) {
    return this._editingReasonIndex === index
      ? html`<article class="manage-item editing reason-edit">
          <input class="edit-reason-name" maxlength="120" .value=${reason.name} aria-label="Název důvodu" />
          <input class="edit-reason-value" type="number" step="1" .value=${reason.value} aria-label="Body" />
          <select class="edit-reason-category" aria-label="Kategorie">${this._reasonCategoryOptions(reason.category || "")}</select>
          <input class="edit-reason-limit" type="number" min="1" step="1" .value=${reason.max_occurrences_per_day ?? ""} placeholder="Bez denního limitu" aria-label="Maximální počet použití za den" />
          <div class="item-actions"><button class="btn" @click=${() => this._saveReasonEdited(index)}>Uložit</button><button class="btn ghost" @click=${this._cancelEdit}>Zrušit</button></div>
        </article>`
      : html`<article class="manage-item reason-card ${this._openReasonMenuId === reason.id ? "menu-open" : ""}" data-reason-id=${reason.id}>
          <div class="reason-card-top">
            <strong class="reason-card-name">${reason.name}</strong>
            <span class="reason-points ${reason.value > 0 ? "positive" : reason.value < 0 ? "negative" : "neutral"}" aria-label=${`${reason.value > 0 ? "plus " : reason.value < 0 ? "minus " : ""}${Math.abs(reason.value)} bodů`}>${reason.value > 0 ? "+" : ""}${reason.value}</span>
          </div>
          <div class="reason-card-bottom">
            <small>${this._reasonCategoryLabel(reason.category)} · ${reason.max_occurrences_per_day ? `max. ${reason.max_occurrences_per_day}× denně` : "bez denního limitu"}</small>
            <div class="reason-menu-container">
              <button class="reason-menu-trigger" type="button" aria-label=${`Akce pro důvod ${reason.name}`} aria-haspopup="menu" aria-expanded=${this._openReasonMenuId === reason.id ? "true" : "false"} aria-controls=${`reason-menu-${reason.id}`} @click=${() => this._toggleReasonMenu(reason.id)}>⋮</button>
              ${this._openReasonMenuId === reason.id
                ? html`<div id=${`reason-menu-${reason.id}`} class="reason-menu" role="menu" aria-label=${`Akce pro důvod ${reason.name}`} @keydown=${this._handleReasonMenuKeydown}>
                    <button type="button" role="menuitem" @click=${() => this._editReason(index)}>Upravit</button>
                    <button type="button" role="menuitem" class="destructive" @click=${() => this._deleteReason(index)}>Smazat</button>
                  </div>`
                : ""}
            </div>
          </div>
        </article>`;
  }

  async _toggleReasonMenu(reasonId) {
    this._openReasonMenuId = this._openReasonMenuId === reasonId ? null : reasonId;
    if (this._openReasonMenuId === reasonId) {
      await this.updateComplete;
      this.shadowRoot.querySelector(`.reason-card[data-reason-id="${reasonId}"] .reason-menu button`)?.focus();
    }
  }

  _handleReasonMenuOutside(event) {
    if (!this._openReasonMenuId) return;
    const openCard = this.shadowRoot?.querySelector(`.reason-card[data-reason-id="${this._openReasonMenuId}"]`);
    if (!openCard || !event.composedPath().includes(openCard)) this._openReasonMenuId = null;
  }

  async _handleReasonMenuEscape(event) {
    if (event.key !== "Escape" || !this._openReasonMenuId) return;
    event.preventDefault();
    const reasonId = this._openReasonMenuId;
    this._openReasonMenuId = null;
    await this.updateComplete;
    this.shadowRoot.querySelector(`.reason-card[data-reason-id="${reasonId}"] .reason-menu-trigger`)?.focus();
  }

  _handleReasonMenuKeydown(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(this.shadowRoot.activeElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  }

  async _editReason(index) {
    this._openReasonMenuId = null;
    this._editingReasonIndex = index;
    await this.updateComplete;
    this.shadowRoot.querySelector(".reason-edit .edit-reason-name")?.focus();
  }

  _reasonCategoryOptions(selected) {
    const categories = [{ id: "", name: "Bez kategorie" }, ...orderedCategories(this.activeProfile?.reason_categories || [])];
    return categories.map((category) => html`<option value=${category.id} ?selected=${selected === category.id}>${category.name}</option>`);
  }

  _reasonCategoryLabel(value) {
    return this.activeProfile?.reason_categories?.find((category) => category.id === value)?.name || "Bez kategorie";
  }

  _switchProfile(event) {
    this.activeProfileId = event.currentTarget.dataset.profileId;
    this.activeTab = "dashboard";
    this._historyLimit = 10;
    this._cancelEdit();
  }

  async _setScore(value, reason) {
    if (!this._canManage || this._saving || !this.activeProfile) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "bodik/set_score", profile_id: this.activeProfile.id, value: Math.trunc(Number(value)), reason });
      await this._loadAllData({ silent: true });
      this._showToast(`Dlouhodobé skóre bylo nastaveno na ${this.score}. Periodický výkon se nemění.`);
    } catch (error) {
      this._showToast(this._errorMessage(error, "Změnu skóre nelze uložit."), true, 7000);
    } finally {
      this._saving = false;
    }
  }

  async _resetPeriod(scope) {
    if (!this._canManage || this._saving || !this.activeProfile) return;
    const profile = this.activeProfile;
    const labels = { daily: "dnešní výkon", weekly: "týdenní výkon", monthly: "měsíční výkon", all: "DLOUHODOBÉ SKÓRE A DENNÍ, TÝDENNÍ I MĚSÍČNÍ VÝKON" };
    const detail = scope === "all"
      ? "Toto je úplný reset. Dlouhodobé skóre i aktuální výkon všech tří období budou vynulovány."
      : "Dlouhodobé skóre a ostatní periodické výkony se nezmění.";
    if (!confirm(`Profil: ${profile.name}\nResetovat ${labels[scope]}?\n${detail}\nHistorie transakcí, uzavřené výsledky, nastavení a již přiznané nároky zůstanou zachovány.`)) return;
    if (scope === "all" && !confirm(`Potvrďte ÚPLNÝ reset profilu ${profile.name}. Tuto změnu aktuálního výkonu nelze vrátit zpět bez zálohy.`)) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "bodik/reset_period", profile_id: profile.id, scope, revision: this._revision });
      await this._loadAllData({ silent: true });
      this._showToast(`Reset profilu ${profile.name} byl uložen.`);
    } catch (error) {
      this._showToast(this._errorMessage(error, "Reset nelze uložit."), true, 7000);
    } finally {
      this._saving = false;
    }
  }

  async _adjustScore(delta, reason) {
    if (!this._canManage || this._saving || !this.activeProfile) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "bodik/adjust_score", profile_id: this.activeProfile.id, delta: Math.trunc(Number(delta)), reason });
      await this._loadAllData({ silent: true });
      this._showToast(`Skóre: ${this.score}`);
    } catch (error) {
      this._showToast(this._errorMessage(error, "Změnu skóre nelze uložit."), true, 7000);
    } finally {
      this._saving = false;
    }
  }

  _applyDelta(event) {
    this._adjustScore(Number(event.currentTarget.dataset.delta), "Manuální změna");
  }

  async _applyReason(event) {
    const reason = event.currentTarget.reason;
    if (!this._canManage || this._saving || !this.activeProfile || !reason?.id) return;
    this._saving = true;
    try {
      await this.hass.callWS({
        type: "bodik/apply_reason",
        profile_id: this.activeProfile.id,
        reason_id: reason.id,
      });
      await this._loadAllData({ silent: true });
      this._showToast(`${reason.name}: skóre ${this.score}`);
    } catch (error) {
      await this._loadAllData({ silent: true });
      this._showToast(this._errorMessage(error, "Důvod nelze použít."), true, 7000);
    } finally {
      this._saving = false;
    }
  }

  _applyCustomDelta() {
    const deltaInput = this.shadowRoot.querySelector("#custom-delta");
    const reasonInput = this.shadowRoot.querySelector("#custom-reason");
    const delta = Number(deltaInput.value);
    if (!Number.isFinite(delta) || delta === 0) {
      this._showToast("Zadejte nenulovou změnu bodů.", true);
      return;
    }
    this._adjustScore(delta, reasonInput.value.trim() || "Vlastní změna");
    deltaInput.value = "";
    reasonInput.value = "";
  }

  _applySetValue() {
    const input = this.shadowRoot.querySelector("#set-value");
    if (!input || input.value.trim() === "") {
      this._showToast("Zadejte nové dlouhodobé skóre.", true);
      return;
    }
    const value = Number(input.value);
    if (!Number.isInteger(value)) {
      this._showToast("Zadejte celé číslo pro dlouhodobé skóre.", true);
      return;
    }
    this._setScore(value, "Nastavení dlouhodobého skóre");
    input.value = "";
  }

  async _clearHistory() {
    if (!confirm(`Vymazat historii profilu ${this.activeProfile.name}? Aktuální skóre ${this.score} zůstane zachováno.`)) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "bodik/clear_history", profile_id: this.activeProfile.id });
      await this._loadAllData({ silent: true });
      this._showToast("Historie byla vyčištěna; skóre zůstalo zachováno.");
    } catch (error) {
      this._showToast(this._errorMessage(error, "Historii nelze vyčistit."), true);
    } finally {
      this._saving = false;
    }
  }

  async _toggleManagerUser(event) {
    const data = this._cloneData();
    const userId = event.currentTarget.dataset.userId;
    const current = new Set(data.admin_user_ids || []);
    event.currentTarget.checked ? current.add(userId) : current.delete(userId);
    data.admin_user_ids = [...current];
    this.appData = data;
    await this._saveConfig("Oprávnění byla aktualizována");
  }

  async _addProfile() {
    const data = this._cloneData();
    const profile = { id: crypto.randomUUID().replaceAll("-", ""), name: "Nový profil", scoreEntity: "", childPhotoUrl: "", theme: "auto", reasons: [], reason_categories: defaultReasonCategories(), history: [], rules: "", score: 0 };
    data.profiles.push(profile);
    this.appData = data;
    this.activeProfileId = profile.id;
    await this._saveConfig("Profil byl přidán");
  }

  async _saveProfileChanges(event) {
    const editor = event.currentTarget.closest(".profile-item");
    const profileId = editor.dataset.profileId;
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    profile.name = editor.querySelector(".profile-name").value.trim();
    profile.scoreEntity = editor.querySelector(".profile-entity").value;
    profile.theme = editor.querySelector(".profile-theme").value;
    profile.childPhotoUrl = editor.querySelector(".profile-photo").value.trim();
    this.appData = data;
    await this._saveConfig("Profil byl uložen");
  }

  async _deleteProfile(event) {
    if (this.profiles.length <= 1) return;
    const editor = event.currentTarget.closest(".profile-item");
    const profileId = editor.dataset.profileId;
    const profile = this.profiles.find((item) => item.id === profileId);
    if (!profile || !confirm(`Smazat profil ${profile.name} včetně jeho historie?`)) return;
    const data = this._cloneData();
    data.profiles = data.profiles.filter((item) => item.id !== profileId);
    this.appData = data;
    if (this.activeProfileId === profileId) this.activeProfileId = data.profiles[0]?.id || null;
    await this._saveConfig("Profil byl smazán");
  }

  async _saveRules() {
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.rules = this.shadowRoot.querySelector("#rules-input").value;
    this.appData = data;
    await this._saveConfig("Další rodinná pravidla byla uložena");
  }

  _prepareReasonForCategory(categoryId) {
    const select = this.shadowRoot.querySelector("#reason-category");
    const input = this.shadowRoot.querySelector("#reason-name");
    if (select) select.value = categoryId;
    input?.focus();
  }

  async _saveCategories() {
    const rows = [...this.shadowRoot.querySelectorAll(".category-row")];
    const categories = rows.map((row) => ({
      id: row.dataset.categoryId,
      name: row.querySelector(".category-name").value.trim(),
      order: Math.trunc(Number(row.querySelector(".category-order").value)),
    }));
    if (categories.some((category) => !category.name || !Number.isFinite(category.order))) {
      return this._showToast("Každá kategorie musí mít název a číselné pořadí.", true);
    }
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reason_categories = categories;
    this.appData = data;
    await this._saveConfig("Kategorie byly uloženy");
  }

  async _addCategory() {
    const input = this.shadowRoot.querySelector("#category-name-new");
    const name = input.value.trim();
    if (!name) return this._showToast("Zadejte název kategorie.", true);
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    const highestOrder = Math.max(0, ...(profile.reason_categories || []).map((item) => Number(item.order) || 0));
    profile.reason_categories = [...(profile.reason_categories || []), {
      id: `category_${crypto.randomUUID().replaceAll("-", "")}`,
      name,
      order: highestOrder + 10,
    }];
    this.appData = data;
    if (await this._saveConfig("Kategorie byla přidána")) input.value = "";
  }

  async _deleteCategory(categoryId) {
    if (categoryId === "offline") {
      return this._showToast("Offline je chráněná kategorie; lze změnit její název a pořadí.", true);
    }
    const category = this.activeProfile.reason_categories?.find((item) => item.id === categoryId);
    if (!category || !confirm(`Smazat kategorii „${category.name}“? Její důvody se přesunou do Bez kategorie.`)) return;
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.reason_categories = profile.reason_categories.filter((item) => item.id !== categoryId);
    profile.reasons.forEach((reason) => {
      if (reason.category === categoryId) reason.category = "";
    });
    this.appData = data;
    await this._saveConfig("Kategorie byla smazána; důvody byly přesunuty do Bez kategorie");
  }

  async _addReason() {
    const nameInput = this.shadowRoot.querySelector("#reason-name");
    const valueInput = this.shadowRoot.querySelector("#reason-points");
    const limitInput = this.shadowRoot.querySelector("#reason-limit");
    const name = nameInput.value.trim();
    const value = Number(valueInput.value);
    const limit = limitInput.value.trim() ? Number(limitInput.value) : null;
    if (!name || !Number.isFinite(value) || (limit !== null && (!Number.isInteger(limit) || limit < 1))) {
      this._showToast("Vyplňte název a počet bodů.", true);
      return;
    }
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reasons.push({
      id: crypto.randomUUID().replaceAll("-", ""),
      name,
      value: Math.trunc(value),
      category: this.shadowRoot.querySelector("#reason-category").value,
      max_occurrences_per_day: limit,
    });
    this.appData = data;
    if (await this._saveConfig("Důvod byl přidán")) {
      nameInput.value = "";
      valueInput.value = "";
      limitInput.value = "";
      this.shadowRoot.querySelector("#reason-category").value = "";
    }
  }

  async _saveReasonEdited(index) {
    const editor = this.shadowRoot.querySelector(".manage-item.editing");
    const name = editor.querySelector(".edit-reason-name").value.trim();
    const value = Number(editor.querySelector(".edit-reason-value").value);
    const limitText = editor.querySelector(".edit-reason-limit").value.trim();
    const limit = limitText ? Number(limitText) : null;
    if (!name || !Number.isFinite(value) || (limit !== null && (!Number.isInteger(limit) || limit < 1))) return this._showToast("Vyplňte platný název, body a denní limit.", true);
    const data = this._cloneData();
    const reason = data.profiles.find((item) => item.id === this.activeProfileId).reasons[index];
    Object.assign(reason, {
      name,
      value: Math.trunc(value),
      category: editor.querySelector(".edit-reason-category").value,
      max_occurrences_per_day: limit,
    });
    this.appData = data;
    this._cancelEdit();
    await this._saveConfig("Důvod byl upraven");
  }

  async _saveOfflineCap() {
    const input = this.shadowRoot.querySelector("#offline-daily-cap");
    const value = input.value.trim() ? Number(input.value) : null;
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      return this._showToast("Offline strop musí být kladné celé číslo nebo prázdný.", true);
    }
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).offline_daily_cap = value;
    this.appData = data;
    await this._saveConfig("Offline denní strop byl uložen");
  }

  async _deleteReason(index) {
    this._openReasonMenuId = null;
    const reason = this.reasons[index];
    if (!confirm(`Smazat důvod „${reason.name}“?`)) return;
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reasons.splice(index, 1);
    this.appData = data;
    await this._saveConfig("Důvod byl smazán");
  }

  _cancelEdit() {
    this._editingReasonIndex = -1;
    this._openReasonMenuId = null;
  }

  _downloadXLSX() {
    if (!window.XLSX) return this._showToast("Knihovna pro XLSX ještě není načtená.", true);
    if (!this.history.length) return this._showToast("Historie je prázdná.", true);
    const rows = [...this.history].reverse().map((entry) => ({
      "Datum a čas": this._fmt(entry.time),
      Uživatel: entry.user,
      Popis: entry.desc,
      Změna: entry.delta,
      "Body před": entry.prev,
      "Body po": entry.next,
    }));
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, "Historie Bodů");
    const safeName = this.activeProfile.name.replace(/[\\/:*?"<>|]/g, "_");
    window.XLSX.writeFile(workbook, `bodik_${safeName}_historie.xlsx`);
  }

  _downloadBackup() {
    if (!this._canManage || !this.profiles.length) return;
    const backup = {
      format: "bodik-backup",
      format_version: 2,
      bodik_version: VERSION,
      exported_at: new Date().toISOString(),
      data: {
        data_version: this.appData.data_version || 4,
        profiles: this.profiles,
        admin_user_ids: this.appData.admin_user_ids || [],
      },
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `bodik_zaloha_${timestamp}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._showToast("Záloha Bodíku byla exportována");
  }

  async _importBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !this._canManage || this._saving) return;

    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Soubor zálohy je příliš velký (maximum je 5 MB).");
      }
      const backup = JSON.parse(await file.text());
      const data = backup?.format === "bodik-backup" ? backup.data : backup;
      if (!data || !Array.isArray(data.profiles) || !data.profiles.length) {
        throw new Error("Soubor neobsahuje platnou zálohu Bodíku.");
      }
      const historyCount = data.profiles.reduce(
        (total, profile) => total + (Array.isArray(profile?.history) ? profile.history.length : 0),
        0,
      );
      if (!confirm(
        `Import nahradí současná data ${data.profiles.length} profily a ${historyCount} záznamy historie. Pokračovat?`,
      )) return;

      this._saving = true;
      const response = await this.hass.callWS({
        type: "bodik/import_backup",
        revision: this._revision,
        backup,
      });
      this._revision = response.revision;
      this.activeProfileId = null;
      await this._loadAllData({ silent: true });
      this._historyLimit = 10;
      this._showToast(`Záloha byla obnovena: ${this.profiles.length} profilů`);
    } catch (error) {
      const message = this._errorMessage(error, "Import zálohy se nezdařil.");
      if (error?.code === "conflict" || message.toLowerCase().includes("mezitím")) {
        await this._loadAllData({ silent: true });
      }
      this._showToast(message, true, 7000);
    } finally {
      this._saving = false;
      input.value = "";
    }
  }

  _fmt(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("cs-CZ");
  }

  _showToast(message, isError = false, duration = 3500) {
    const container = this.shadowRoot?.querySelector("#toast-notifications");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${isError ? "error" : ""}`;
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => toast.classList.add("leaving"), Math.max(0, duration - 300));
    window.setTimeout(() => toast.remove(), duration);
  }
}

if (!customElements.get("bodik-panel")) customElements.define("bodik-panel", BodikPanel);
if (!customElements.get("bodik-panel-v9")) {
  customElements.define("bodik-panel-v9", class BodikPanelV9Alias extends BodikPanel {});
}
if (!customElements.get("bodik-panel-v8")) {
  customElements.define("bodik-panel-v8", class BodikPanelV8Alias extends BodikPanel {});
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "bodik-panel")) {
  window.customCards.push({
    type: "bodik-panel",
    name: "Bodík",
    description: "Rodinný bodovací systém pro Home Assistant",
  });
}
