// Descriptors for the six built-in audit-panel sections. Each is ported from its former
// Thymeleaf fragment (fragments/audit-panel/*.html); the handful of i18n-translated labels
// become English-only literals (this is a dev-only tool and taxpert-ui has no i18n system).
//
// Shape: { sectionId, dataTab, label, title, order, wrapperClass?, ff?, eager?, buildBody(el) }.
//   sectionId  — the section <div> id (CSS + JS depend on the exact original values)
//   dataTab    — the data-tab value the rail button + section share (drives CSS visibility)
//   label      — the short rail-tab label
//   title      — accessible tab title / sr-only name
//   order      — rail position
//   ff         — feature-flag name (kebab) gating the rail tab's visibility
//   buildBody  — fills the section container's innerHTML (the panel adds the wrapper div)
//
// The CA-owned Eligibility section is registered separately at runtime via registerSection().

const ICON_BASE = '/app/eitc/resources/vendor/uswds-3.13.0/img'

export const BUILT_IN_SECTIONS = [
  {
    sectionId: 'audit-panel-view-options-section',
    dataTab: 'view-options',
    label: 'Flow',
    title: 'Flow Inspector',
    order: 10,
    buildBody (el) {
      el.innerHTML = `
        <h2>Flow Inspector</h2>
        <fieldset class="usa-fieldset padding-bottom-4">
          <legend class="usa-legend usa-sr-only">View options</legend>
          <div class="usa-checkbox">
            <input class="usa-checkbox__input" id="show-conditions" type="checkbox" name="view-options" value="show-conditions" />
            <label class="usa-checkbox__label" for="show-conditions">Show conditions</label>
          </div>
        </fieldset>`
    },
  },
  {
    sectionId: 'audit-panel-fact-graph-section',
    dataTab: 'fact-graph',
    label: 'Fact',
    title: 'Fact Inspector',
    order: 20,
    buildBody (el) {
      el.innerHTML = `
        <h2>Fact Inspector</h2>
        <div id="audit-panel__fact-list"></div>
        <div class="usa-form-group">
          <label class="usa-label twe-question" for="fact-select">Fact Path</label>
          <input list="fact-options" class="usa-input" onkeydown="pathSelectListener(event)" id="fact-select">
          <datalist id="fact-options" aria-invalid="false"></datalist>
        </div>
        <div class="usa-form-group">
          <label class="usa-label twe-question" for="fact-collection-id">Collection ID</label>
          <input id="fact-collection-id" class="usa-input" type="text" autocomplete="off" aria-invalid="false">
        </div>
        <button class="usa-button" id="add-fact-button" type="button" onclick="trackSelectedFact()">Add fact</button>`
    },
  },
  {
    sectionId: 'audit-panel-reset-section',
    dataTab: 'reset',
    label: 'Graph',
    title: 'Graph Inspector',
    order: 30,
    buildBody (el) {
      el.innerHTML = `
        <h2>Fact Graph Inspector</h2>
        <div class="audit-panel__section">
          <h3>Copy Fact Graph</h3>
          <div>
            <button class="usa-button inline" type="button" onclick="copyFactGraphToClipboard()">
              <svg aria-hidden="true" role="img" focusable="false" class="usa-icon usa-icon--size-3 margin-left-neg-1 margin-y-neg-05">
                <use href="${ICON_BASE}/sprite.svg#content_copy"/>
              </svg>
              Copy Fact Graph
            </button>
            <span id="copy-fg-status">Copied to clipboard!</span>
          </div>
        </div>
        <div class="audit-panel__section">
          <h3>Load Fact Graph</h3>
          <div class="usa-form-group">
            <label class="usa-label" for="load-fact-graph">Paste Fact Graph</label>
            <textarea id="load-fact-graph" class="usa-textarea" onchange="this.setCustomValidity('')"></textarea>
          </div>
          <button class="usa-button" type="button" onclick="loadFactGraphFromAuditPanel()">Set Fact Graph</button>
        </div>
        <div class="audit-panel__section">
          <h3>Reset Fact Graph</h3>
          <fg-reset>
            <button class="usa-button usa-button--outline" type="reset">Start over</button>
          </fg-reset>
        </div>`
    },
  },
  {
    sectionId: 'audit-panel-explain-section',
    dataTab: 'chat-explain',
    label: 'Explain',
    title: 'Explain',
    order: 50,
    wrapperClass: 'audit-panel__section--chat',
    ff: 'ai-mode',
    buildBody (el) {
      el.innerHTML = `
        <h2>Explain &amp; Analyze</h2>
        <div id="chat-status" class="chat-status"></div>
        <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-label="Chat conversation"></div>
        <div class="chat-input-row">
          <div class="usa-form-group">
            <label class="usa-label twe-question" for="chat-fact-select">Fact Path</label>
            <div class="ap-fact-row">
              <input list="chat-fact-options" class="usa-input" onkeydown="pathSelectListener(event)" id="chat-fact-select">
              <button class="usa-button usa-button--unstyled" type="button" title="Clear all tracked facts" aria-label="Clear all tracked facts" onclick="clearTrackedFacts()">Clear facts</button>
            </div>
            <datalist id="chat-fact-options" aria-invalid="false"></datalist>
          </div>
          <textarea class="chat-container__textarea" placeholder="Ask me about The EITC Assistant..." aria-label="Ask the EITC Assistant" rows="3"></textarea>
          <button id="chat-submit-btn" class="chat-container__submit-btn" type="button" aria-label="Submit question to EITC Assistant">Send</button>
        </div>`
    },
  },
  {
    sectionId: 'audit-panel-scenarios-section',
    dataTab: 'scenarios',
    label: 'Scenarios',
    title: 'Scenarios',
    order: 60,
    buildBody (el) {
      // The .scenario-filters container is populated by the host via registerScenarioFilters();
      // the <select> options are supplied by the host as light-DOM children of the panel.
      el.innerHTML = `
        <h2>Scenarios</h2>
        <div class="scenario-filters"></div>
        <div class="usa-form-group">
          <label class="usa-label" for="scenario-select">Select a scenario</label>
          <select class="usa-select" id="scenario-select">
            <option value="" disabled="disabled" selected="selected">-- Choose a scenario --</option>
          </select>
        </div>
        <button class="usa-button" type="button" id="load-scenario-btn">Load Scenario</button>
        <button type="button" id="all-screens-clear-scenario" class="usa-button usa-button--unstyled">Clear scenario</button>

        <hr class="scenario-gen__divider">
        <h3>Generate a scenario with AI</h3>
        <div class="usa-form-group">
          <label class="usa-label" for="scenario-gen-prompt">Describe the scenario you want</label>
          <textarea class="usa-textarea" id="scenario-gen-prompt" rows="3" placeholder="e.g. single filer, 2 qualifying children, 2024, ~$55k wages, disqualified"></textarea>
        </div>
        <button class="usa-button" type="button" id="generate-scenario-btn">Generate scenario</button>
        <div id="scenario-gen-status" class="scenario-gen__status" role="status" aria-live="polite"></div>
        <div id="scenario-gen-result" class="scenario-gen__result" hidden="hidden">
          <p id="scenario-gen-description" class="scenario-gen__description"></p>
          <button class="usa-button usa-button--outline" type="button" id="download-scenario-btn">Download .json</button>
        </div>`
    },
  },
  {
    sectionId: 'audit-panel-flags-section',
    dataTab: 'feature-flags',
    label: 'Flags',
    title: 'Feature Flags',
    order: 70,
    buildBody (el) {
      el.innerHTML = `
        <h2>Feature Flags</h2>
        <p class="usa-hint">Runtime overrides (stored in browser localStorage) take precedence over the build-time default. Changes apply immediately without a page reload.</p>
        <fieldset class="usa-fieldset">
          <legend class="usa-legend">AI Features</legend>
          <div class="usa-checkbox">
            <input class="usa-checkbox__input" id="ff-ai-mode" type="checkbox" name="feature-flags" value="ai-mode" />
            <label class="usa-checkbox__label" for="ff-ai-mode">AI Mode</label>
          </div>
          <p class="ff-hint usa-hint" id="ff-ai-mode-hint"></p>
          <p class="usa-hint ff-flag-desc">Enables the Explain &amp; Analyze chat tab and all ✨ Explain buttons. Off by default until the backend prompt engineering is robust.</p>
        </fieldset>`
    },
  },
]
