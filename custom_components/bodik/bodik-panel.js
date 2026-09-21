// Bodík v9.0.0 — authenticated WebSocket client for the Bodík integration.
import { LitElement, html, css } from "/local/lit-element.js";

const VERSION = "9.0.0";

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
      _editingReasonIndex: { type: Number, state: true },
      _editingRewardId: { type: String, state: true },
      _error: { type: String, state: true },
      _haEntities: { type: Array, state: true },
      _historyLimit: { type: Number, state: true },
      _loading: { type: Boolean, state: true },
      _revision: { type: Number, state: true },
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
    this._editingReasonIndex = -1;
    this._editingRewardId = null;
    this._error = "";
    this._haEntities = [];
    this._historyLimit = 10;
    this._loading = true;
    this._revision = 0;
    this._saving = false;
    this._dataLoaded = false;
    this._unsubscribeUpdates = null;
    this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
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

  get rewards() {
    return this.activeProfile?.rewards || [];
  }

  get history() {
    return this.activeProfile?.history || [];
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._boundVisibilityChange);
    this._refreshInterval = window.setInterval(() => {
      if (!document.hidden) this._loadAllData({ silent: true });
    }, 600000);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._boundVisibilityChange);
    if (this._refreshInterval) window.clearInterval(this._refreshInterval);
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
      this.appData = response.data || { profiles: [], admin_user_ids: [] };
      this._revision = response.revision || this.appData.revision || 0;
      this._canManage = response.can_manage === true;
      this._availableUsers = response.available_users || [];
      this.activeProfileId = this.profiles.some((item) => item.id === previousActive)
        ? previousActive
        : this.profiles[0]?.id || null;
      if (!this._canManage && this.activeTab === "settings") this.activeTab = "dashboard";
      this._error = "";
    } catch (error) {
      this._error = this._errorMessage(error, "Backend Bodíku není dostupný.");
      console.error("Bodík: načtení dat selhalo", error);
    } finally {
      this._loading = false;
    }
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
      <link rel="stylesheet" href="/bodik-panel/bodik-panel.css?v=${VERSION}" />
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
                  <span class="profile-score"><strong>${this.score}</strong><span>bodů</span></span>
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
    const goals = this._computeGoals();
    const visibleHistory = [...this.history].reverse().slice(0, this._historyLimit);
    return html`
      <section class="card focus">
        <div class="focus-block score-block">
          <div class="label">Body · ${this.activeProfile.name}</div>
          <div class="score">${this.score}</div>
        </div>
        <div class="focus-block">
          <div class="label">Odemčeno</div>
          <div>${goals.unlockedText}</div>
        </div>
        <div class="focus-block">
          <div class="label">Další cíl</div>
          <div class="next">${goals.nextGoalText}</div>
        </div>
      </section>

      ${this._renderPeriodicDashboard()}

      ${this.activeProfile.rules
        ? html`<section class="card"><h2>Pravidla</h2><div class="rules-text">${this.activeProfile.rules}</div></section>`
        : ""}

      ${this._canManage ? this._renderQuickActions() : ""}

      <section class="card">
        <h2>Rychlé důvody</h2>
        ${!this._canManage ? html`<p class="note">Body mohou měnit pouze rodiče.</p>` : ""}
        <div class="reasons">
          ${this.reasons.length
            ? this.reasons.map(
                (reason) => html`
                  <button class="reason" .reason=${reason} @click=${this._applyReason} ?disabled=${!this._canManage || this._saving}>
                    <span class="name">${reason.name}</span>
                    <span class="pts ${reason.value >= 0 ? "positive" : "negative"}">${reason.value >= 0 ? "+" : ""}${reason.value}</span>
                  </button>
                `,
              )
            : html`<p class="muted">Nejsou nastavené žádné rychlé důvody.</p>`}
        </div>
      </section>

      ${this._renderRewardsSummary()}

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
    const reward = weekly.active_reward;
    const monthlyCap = Number(config.max_payout_percent || 150);
    return html`
      <section class="card periodic-card">
        <div class="section-head">
          <div><h2>Periodické cíle</h2><span class="muted small">Výkon se počítá odděleně od dlouhodobého skóre</span></div>
        </div>
        <article class="periodic-goal daily-goal">
          <div class="periodic-heading"><div><span class="periodic-kicker">Dnes</span><strong>${daily.points} / ${daily.target} bodů</strong></div><span>${daily.remaining ? `Zbývá ${daily.remaining} b.` : "Cíl splněn"}</span></div>
          <div class="progress"><span style=${`width:${this._progressWidth(daily.points, daily.target)}%`}></span></div>
          <div class="periodic-details">
            <span><strong>${daily.today_entitlement} / ${config.max_digital_minutes} min</strong> dostupných dnes</span>
            <span>Pokud den skončí nyní: <strong>${daily.tomorrow_entitlement_preview} min zítra</strong></span>
          </div>
        </article>
        <div class="periodic-secondary">
          <article class="periodic-goal">
            <div class="periodic-heading"><div><span class="periodic-kicker">Tento týden</span><strong>${weekly.points} / ${weekly.target}</strong></div></div>
            <div class="progress weekly"><span style=${`width:${this._progressWidth(weekly.points, weekly.target)}%`}></span></div>
            <div class="periodic-details single">
              ${weekly.previous_result
                ? html`<span>Minulý uzavřený týden: <strong>${weekly.previous_result.points} / ${weekly.previous_result.target}</strong>${weekly.previous_result.initial_partial ? " · úvodní částečné období" : ""}</span>`
                : html`<span class="muted">První týden ještě nebyl uzavřen.</span>`}
              ${reward?.enabled
                ? html`<span class=${reward.unlocked ? "positive" : "muted"}><strong>${reward.label}</strong> · ${reward.unlocked ? "odemčeno" : "neodemčeno"}${reward.description ? html`<small>${reward.description}</small>` : ""}</span>`
                : html`<span class="muted">Týdenní odměna není zapnutá.</span>`}
            </div>
          </article>
          <article class="periodic-goal">
            <div class="periodic-heading"><div><span class="periodic-kicker">Tento měsíc</span><strong>${monthly.points} / ${monthly.target} · ${monthly.estimated_allowance.completion_percent}%</strong></div></div>
            <div class="progress monthly"><span style=${`width:${this._progressWidth(monthly.points, monthly.target, monthlyCap) / monthlyCap * 100}%`}></span></div>
            <div class="periodic-details single"><span>Odhad kapesného: <strong>${monthly.estimated_allowance.amount} Kč</strong> (${monthly.estimated_allowance.payout_percent} %)</span></div>
          </article>
        </div>
      </section>
    `;
  }

  _renderQuickActions() {
    return html`
      <section class="card">
        <h2>Rychlé změny</h2>
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
          <div class="form-row set-score">
            <label class="sr-only" for="set-value">Nové výsledné skóre</label>
            <input id="set-value" type="number" step="1" placeholder="Nastavit na…" />
            <button class="btn ghost" @click=${this._applySetValue} ?disabled=${this._saving}>Nastavit skóre</button>
            <button class="btn danger" @click=${() => this._setScore(0, "Reset bodů")} ?disabled=${this._saving}>Vynulovat</button>
          </div>
        </div>
      </section>
    `;
  }

  _renderRewardsSummary() {
    const sorted = [...this.rewards].sort((a, b) => a.threshold - b.threshold);
    return html`
      <section class="card">
        <h2>Odměny</h2>
        <div class="rewards-summary-grid">
          ${sorted.length
            ? sorted.map((reward) => {
                const unlocked = this.score >= reward.threshold;
                return html`
                  <article class="reward-summary-item ${unlocked ? "unlocked" : "locked"}">
                    <div class="pts">${reward.threshold} b.</div>
                    <div class="name">${reward.category}</div>
                    ${this._formatRewardLevel(reward) ? html`<div class="level">${this._formatRewardLevel(reward)}</div>` : ""}
                    <span class="sr-only">${unlocked ? "Odemčeno" : "Zamčeno"}</span>
                  </article>
                `;
              })
            : html`<p class="muted">Nejsou nastavené žádné odměny.</p>`}
        </div>
      </section>
    `;
  }

  _renderSettings() {
    return html`
      <section class="card">
        <h2>Oprávnění rodičů</h2>
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
      </section>

      <section class="card">
        <div class="section-head"><h2>Profily</h2><button class="btn" @click=${this._addProfile} ?disabled=${this._saving}>Přidat profil</button></div>
        <div class="profile-manager">
          ${this.profiles.map((profile) => this._renderProfileEditor(profile))}
        </div>
      </section>

      <section class="card">
        <h2>Pravidla · ${this.activeProfile.name}</h2>
        <label for="rules-input">Text pravidel</label>
        <textarea id="rules-input" class="rules-editor" maxlength="5000" .value=${this.activeProfile.rules || ""}></textarea>
        <button class="btn" @click=${this._saveRules} ?disabled=${this._saving}>Uložit pravidla</button>
      </section>

      ${this._renderReasonSettings()}
      ${this._renderPeriodicSettings()}
      ${this._renderRewardSettings()}

      <section class="card">
        <h2>Záloha a obnova</h2>
        <p class="note">
          Kompletní JSON záloha obsahuje profily, skóre, pravidla, důvody, odměny,
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
      </section>

      <section class="card">
        <h2>Diagnostika</h2>
        <div class="diagnostics">
          <div><span>Backend</span><strong>Připojen</strong></div>
          <div><span>Revize dat</span><strong>${this._revision}</strong></div>
          <div><span>Profily</span><strong>${this.profiles.length}</strong></div>
          <div><span>Zrcadlo skóre</span><strong>${this.activeProfile.scoreEntity || "nenastaveno"}</strong></div>
          <div><span>Historie</span><strong>${this.history.length} záznamů</strong></div>
        </div>
        <button class="btn ghost" @click=${() => this._loadAllData()}>Otestovat spojení</button>
      </section>
    `;
  }

  _renderPeriodicSettings() {
    const cfg = this.activeProfile.periodic_config || {};
    const reward = cfg.weekly_reward || {};
    const bands = cfg.payout_bands || [];
    return html`
      <section class="card periodic-settings">
        <h2>Periodické cíle · ${this.activeProfile.name}</h2>
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
      </section>
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
    return html`
      <section class="card">
        <h2>Důvody · ${this.activeProfile.name}</h2>
        <div class="form-row">
          <label class="grow">Název<input id="reason-name" maxlength="120" /></label>
          <label class="number-field">Body<input id="reason-points" type="number" step="1" /></label>
          <button class="btn align-end" @click=${this._addReason} ?disabled=${this._saving}>Přidat</button>
        </div>
        <div class="manage-grid">
          ${this.reasons.map((reason, index) =>
            this._editingReasonIndex === index
              ? html`
                  <article class="manage-item editing">
                    <input class="edit-reason-name" maxlength="120" .value=${reason.name} aria-label="Název důvodu" />
                    <input class="edit-reason-value" type="number" step="1" .value=${reason.value} aria-label="Body" />
                    <div class="item-actions"><button class="btn" @click=${() => this._saveReasonEdited(index)}>Uložit</button><button class="btn ghost" @click=${this._cancelEdit}>Zrušit</button></div>
                  </article>
                `
              : html`
                  <article class="manage-item"><span>${reason.name}</span><strong class=${reason.value >= 0 ? "positive" : "negative"}>${reason.value >= 0 ? "+" : ""}${reason.value}</strong><div class="item-actions"><button class="btn ghost small-btn" @click=${() => (this._editingReasonIndex = index)}>Upravit</button><button class="btn danger small-btn" @click=${() => this._deleteReason(index)}>Smazat</button></div></article>
                `,
          )}
        </div>
      </section>
    `;
  }

  _renderRewardSettings() {
    const sorted = [...this.rewards].sort((a, b) => a.threshold - b.threshold);
    return html`
      <section class="card">
        <h2>Odměny · ${this.activeProfile.name}</h2>
        <div class="reward-form">
          <label>Kategorie<input id="reward-category" maxlength="120" placeholder="Např. iPad" /></label>
          <label>Počet<input id="reward-value" type="number" step="1" /></label>
          <label>Jednotka<input id="reward-unit" maxlength="60" placeholder="hodiny" /></label>
          <label>Období<input id="reward-period" maxlength="60" placeholder="týdně" /></label>
          <label>Potřebné body<input id="reward-threshold" type="number" step="1" /></label>
          <button class="btn align-end" @click=${this._addReward} ?disabled=${this._saving}>Přidat</button>
        </div>
        <div class="manage-grid">
          ${sorted.map((reward) =>
            this._editingRewardId === reward.id
              ? html`
                  <article class="manage-item editing reward-edit" data-reward-id=${reward.id}>
                    <input class="edit-reward-category" maxlength="120" .value=${reward.category} aria-label="Kategorie" />
                    <input class="edit-reward-value" type="number" .value=${reward.value ?? ""} aria-label="Počet" />
                    <input class="edit-reward-unit" maxlength="60" .value=${reward.unit ?? ""} aria-label="Jednotka" />
                    <input class="edit-reward-period" maxlength="60" .value=${reward.period ?? ""} aria-label="Období" />
                    <input class="edit-reward-threshold" type="number" .value=${reward.threshold} aria-label="Potřebné body" />
                    <div class="item-actions"><button class="btn" @click=${() => this._saveRewardEdited(reward.id)}>Uložit</button><button class="btn ghost" @click=${this._cancelEdit}>Zrušit</button></div>
                  </article>
                `
              : html`
                  <article class="manage-item"><span><strong>${reward.category}</strong>${this._formatRewardLevel(reward) ? html`<small>${this._formatRewardLevel(reward)}</small>` : ""}</span><strong>${reward.threshold} b.</strong><div class="item-actions"><button class="btn ghost small-btn" @click=${() => (this._editingRewardId = reward.id)}>Upravit</button><button class="btn danger small-btn" @click=${() => this._deleteReward(reward.id)}>Smazat</button></div></article>
                `,
          )}
        </div>
      </section>
    `;
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
      this._showToast(`Skóre bylo nastaveno na ${this.score}`);
    } catch (error) {
      this._showToast(this._errorMessage(error, "Změnu skóre nelze uložit."), true, 7000);
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

  _applyReason(event) {
    const reason = event.currentTarget.reason;
    this._adjustScore(reason.value, reason.name);
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
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      this._showToast("Zadejte výsledné skóre.", true);
      return;
    }
    this._setScore(value, "Manuální nastavení");
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
    const profile = { id: crypto.randomUUID().replaceAll("-", ""), name: "Nový profil", scoreEntity: "", childPhotoUrl: "", theme: "auto", reasons: [], rewards: [], history: [], rules: "", score: 0 };
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
    await this._saveConfig("Pravidla byla uložena");
  }

  async _addReason() {
    const nameInput = this.shadowRoot.querySelector("#reason-name");
    const valueInput = this.shadowRoot.querySelector("#reason-points");
    const name = nameInput.value.trim();
    const value = Number(valueInput.value);
    if (!name || !Number.isFinite(value)) {
      this._showToast("Vyplňte název a počet bodů.", true);
      return;
    }
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reasons.push({ name, value: Math.trunc(value) });
    this.appData = data;
    if (await this._saveConfig("Důvod byl přidán")) {
      nameInput.value = "";
      valueInput.value = "";
    }
  }

  async _saveReasonEdited(index) {
    const editor = this.shadowRoot.querySelector(".manage-item.editing");
    const name = editor.querySelector(".edit-reason-name").value.trim();
    const value = Number(editor.querySelector(".edit-reason-value").value);
    if (!name || !Number.isFinite(value)) return this._showToast("Vyplňte název a počet bodů.", true);
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reasons[index] = { name, value: Math.trunc(value) };
    this.appData = data;
    this._cancelEdit();
    await this._saveConfig("Důvod byl upraven");
  }

  async _deleteReason(index) {
    const reason = this.reasons[index];
    if (!confirm(`Smazat důvod „${reason.name}“?`)) return;
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).reasons.splice(index, 1);
    this.appData = data;
    await this._saveConfig("Důvod byl smazán");
  }

  async _addReward() {
    const category = this.shadowRoot.querySelector("#reward-category").value.trim();
    const valueText = this.shadowRoot.querySelector("#reward-value").value.trim();
    const unit = this.shadowRoot.querySelector("#reward-unit").value.trim() || null;
    const period = this.shadowRoot.querySelector("#reward-period").value.trim() || null;
    const threshold = Number(this.shadowRoot.querySelector("#reward-threshold").value);
    const value = valueText ? Number(valueText) : null;
    if (!category || !Number.isFinite(threshold) || (value !== null && !Number.isFinite(value))) {
      this._showToast("Vyplňte platnou kategorii a potřebné body.", true);
      return;
    }
    const data = this._cloneData();
    data.profiles.find((item) => item.id === this.activeProfileId).rewards.push({ id: crypto.randomUUID().replaceAll("-", ""), category, value, unit, period, threshold: Math.trunc(threshold) });
    this.appData = data;
    if (await this._saveConfig("Odměna byla přidána")) {
      for (const selector of ["#reward-category", "#reward-value", "#reward-unit", "#reward-period", "#reward-threshold"]) this.shadowRoot.querySelector(selector).value = "";
    }
  }

  async _saveRewardEdited(rewardId) {
    const editor = this.shadowRoot.querySelector(`.reward-edit[data-reward-id="${CSS.escape(rewardId)}"]`);
    const category = editor.querySelector(".edit-reward-category").value.trim();
    const valueText = editor.querySelector(".edit-reward-value").value.trim();
    const threshold = Number(editor.querySelector(".edit-reward-threshold").value);
    const value = valueText ? Number(valueText) : null;
    if (!category || !Number.isFinite(threshold) || (value !== null && !Number.isFinite(value))) return this._showToast("Vyplňte platné hodnoty odměny.", true);
    const data = this._cloneData();
    const rewards = data.profiles.find((item) => item.id === this.activeProfileId).rewards;
    const reward = rewards.find((item) => item.id === rewardId);
    Object.assign(reward, { category, value, unit: editor.querySelector(".edit-reward-unit").value.trim() || null, period: editor.querySelector(".edit-reward-period").value.trim() || null, threshold: Math.trunc(threshold) });
    this.appData = data;
    this._cancelEdit();
    await this._saveConfig("Odměna byla upravena");
  }

  async _deleteReward(rewardId) {
    const reward = this.rewards.find((item) => item.id === rewardId);
    if (!reward || !confirm(`Smazat odměnu „${reward.category}“?`)) return;
    const data = this._cloneData();
    const profile = data.profiles.find((item) => item.id === this.activeProfileId);
    profile.rewards = profile.rewards.filter((item) => item.id !== rewardId);
    this.appData = data;
    await this._saveConfig("Odměna byla smazána");
  }

  _cancelEdit() {
    this._editingReasonIndex = -1;
    this._editingRewardId = null;
  }

  _formatRewardLevel(reward) {
    return [reward.value, reward.unit, reward.period].filter((value) => value !== null && value !== undefined && value !== "").join(" ");
  }

  _computeGoals() {
    const groups = new Map();
    for (const reward of [...this.rewards].sort((a, b) => a.threshold - b.threshold)) {
      if (!groups.has(reward.category)) groups.set(reward.category, []);
      groups.get(reward.category).push(reward);
    }
    const unlocked = [];
    let nextGoal = null;
    for (const rewards of groups.values()) {
      const achieved = rewards.filter((item) => this.score >= item.threshold).at(-1);
      if (achieved) unlocked.push(`${achieved.category}${this._formatRewardLevel(achieved) ? ` (${this._formatRewardLevel(achieved)})` : ""}`);
      const upcoming = rewards.find((item) => this.score < item.threshold);
      if (upcoming && (!nextGoal || upcoming.threshold < nextGoal.threshold)) nextGoal = upcoming;
    }
    return {
      unlockedText: unlocked.length ? unlocked.join(", ") : "Zatím žádná odměna",
      nextGoalText: nextGoal ? `${nextGoal.category} · zbývá ${nextGoal.threshold - this.score} b.` : this.rewards.length ? "Všechny odměny jsou odemčené" : "Není nastavený cíl",
    };
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
