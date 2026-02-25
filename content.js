// Content script — injected into officevibe.workleap.com pages
// Detects feedback pages and injects AI suggestion UI + Slack similarity search

(function () {
  "use strict";

  const EXTENSION_ID = "ov-ai-assistant";
  let listObserver = null;

  // ─── Utility ────────────────────────────────────────────────────────────────

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function sendToBackground(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error("No response from background"));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error || "Unknown error"));
          return;
        }
        resolve(response.data);
      });
    });
  }

  // Safely escape text before inserting into innerHTML
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Confirmed DOM Selectors (from live Officevibe page) ─────────────────────
  //
  // List panel (left side):
  //   .virtual-scroll-list-content                      ← virtual scroll root
  //     .conversation-summary-item-container[style]     ← outer slot (has height:123px)
  //       .conversation-summary-item-container          ← inner wrapper
  //         button.survey-conversation-summary          ← clickable card
  //           .summary-message[data-hj-suppress]
  //             span.message-text                       ← THE FEEDBACK TEXT
  //           .summary-footer
  //             .survey-feedback-type                   ← "Feedback", "Custom question", etc.
  //           .author-name__ellipsis                    ← author name
  //           .message-date                             ← date string
  //
  // Conversation detail panel (right side):
  //   .feedback-conversation-reply-control              ← reply area container
  //     [data-testid="feedback-reply-textarea"] textarea← type reply here
  //     [data-testid="feedback-reply-help-me-button"]   ← Officevibe's own AI button
  //     [data-testid="feedback-reply-send-button"]      ← send button
  //   .survey-conversation-message-container[data-hj-suppress]
  //     .message-content                                ← the employee's answer text

  const VIRTUAL_LIST_SEL   = ".virtual-scroll-list-content";
  const CARD_OUTER_SEL     = ".conversation-summary-item-container";
  const FEEDBACK_TEXT_SEL  = "span.message-text";
  const REPLY_CONTROL_SEL  = ".feedback-conversation-reply-control";
  const REPLY_TEXTAREA_SEL = '[data-testid="feedback-reply-textarea"] textarea';
  const REPLY_HELP_BTN_SEL = '[data-testid="feedback-reply-help-me-button"]';
  const DETAIL_MSG_SEL     = ".survey-conversation-message-container[data-hj-suppress] .message-content";

  // ─── Team Insights Selectors ─────────────────────────────────────────────────
  const METRIC_LABEL_SEL              = ".metric-variation-block__content";
  const INSIGHTS_STORAGE_KEY           = "ov_ai_team_insights";
  const COMPARE_METRICS_STORAGE_KEY    = "ov_ai_compare_metrics";
  const FEEDBACK_SURVEY_STORAGE_KEY    = "ov_ai_recent_feedback";
  const RECOGNITION_UNSEEN_STORAGE_KEY = "ov_ai_recognition_unseen";
  const HOME_CARD_SEL                 = ".card.empty-checklist-card, .home-page-checklist-card.home-page__checklist";
  const TAKE_SURVEY_BOX_SEL           = ".home-page-take-survey";
  const RECOGNITION_LINK_SEL          = ".contextual-link.call-to-action-link";
  const RECOGNITION_NOT_SEEN_SEL      = ".recognition-card--public--not-seen";

  // Candidate selectors for Officevibe's "Share" button in the conversation header.
  // Tried in order; first match wins.
  const SHARE_BTN_SELECTORS = [
    '[data-testid="share-feedback-button"]',
    '[data-testid="feedback-share-button"]',
    '[data-testid*="share"]',
    'button[title*="Share" i]',
    'button[aria-label*="Share" i]',
  ];

  // ─── Feedback Item Extraction ────────────────────────────────────────────────

  function findFeedbackItems() {
    const list = document.querySelector(VIRTUAL_LIST_SEL);
    if (!list) return [];

    // Direct children of the virtual list are the outer .conversation-summary-item-container
    // divs (the ones with style="height:123px"). We skip the trailing spacer div.
    return Array.from(list.children).filter((el) => {
      if (!el.classList.contains("conversation-summary-item-container")) return false;
      if (el.querySelector(`.${EXTENSION_ID}-btn-wrapper`)) return false; // already injected
      const textEl = el.querySelector(FEEDBACK_TEXT_SEL);
      const text = textEl ? textEl.textContent.trim() : "";
      return text.length > 3;
    });
  }

  function extractFeedbackText(el) {
    const textEl = el.querySelector(FEEDBACK_TEXT_SEL);
    if (textEl) return textEl.textContent.trim().replace(/\s+/g, " ");
    return el.textContent.trim().replace(/\s+/g, " ");
  }

  // ─── Slack Similarity Search (displayed inside the AI panel) ─────────────────
  // Fires automatically when any AI panel opens. Silently hides itself
  // if no Slack token is configured; shows a compact error otherwise.

  async function searchSlack(feedbackText, panel) {
    const slackSection = panel.querySelector(`.${EXTENSION_ID}-slack-section`);
    const slackResults = panel.querySelector(`.${EXTENSION_ID}-slack-results`);
    const countBadge   = panel.querySelector(`.${EXTENSION_ID}-slack-count-badge`);
    if (!slackSection || !slackResults) return;

    // Reveal section and show loading spinner
    slackSection.style.display = "block";
    slackResults.innerHTML = `
      <div class="${EXTENSION_ID}-loading">
        <div class="${EXTENSION_ID}-spinner"></div>
        <span>Searching Slack & curating…</span>
      </div>
    `;

    try {
      const matches = await sendToBackground("SEARCH_SLACK_SIMILAR", { feedbackText });

      if (!matches || matches.length === 0) {
        // No relevant matches — hide the section cleanly
        slackSection.style.display = "none";
        return;
      }

      // Show match count badge in header
      if (countBadge) {
        countBadge.textContent = matches.length;
        countBadge.style.display = "inline-flex";
      }

      // Render 2-3 curated Slack results, each with a Claude-generated
      // suggestion for how to incorporate the thread in the manager's reply.
      slackResults.innerHTML = matches.map((m) => `
        <div class="${EXTENSION_ID}-slack-item">
          <div class="${EXTENSION_ID}-slack-item-header">
            <span class="${EXTENSION_ID}-slack-badge">#${escapeHtml(m.channel)}</span>
            <span class="${EXTENSION_ID}-slack-item-author">
              ${escapeHtml(m.author)}${m.date ? ` · ${escapeHtml(m.date)}` : ""}
            </span>
          </div>
          <div class="${EXTENSION_ID}-slack-item-text">${escapeHtml(m.text)}</div>
          ${m.suggestion ? `
            <div class="${EXTENSION_ID}-slack-suggestion">
              <span class="${EXTENSION_ID}-slack-suggestion-label">💡 Use in reply</span>
              ${escapeHtml(m.suggestion)}
            </div>
          ` : ""}
          ${m.permalink ? `
            <a href="${escapeHtml(m.permalink)}" target="_blank" rel="noopener noreferrer"
               class="${EXTENSION_ID}-slack-link">View thread in Slack ↗</a>
          ` : ""}
        </div>
      `).join("");

    } catch (err) {
      console.error("[OV AI] Slack similar search:", err);
      if (err.message.includes("No Slack token")) {
        slackSection.style.display = "none";
      } else {
        slackResults.innerHTML = `
          <div class="${EXTENSION_ID}-slack-item-error">⚠ ${escapeHtml(err.message)}</div>
        `;
      }
    }
  }

  // ─── Glassdoor Reviews (displayed inside the AI panel) ─────────────────────

  async function searchGlassdoor(panel) {
    const glassdoorSection = panel.querySelector(`.${EXTENSION_ID}-glassdoor-section`);
    const glassdoorResults = panel.querySelector(`.${EXTENSION_ID}-glassdoor-results`);
    const countBadge       = panel.querySelector(`.${EXTENSION_ID}-glassdoor-count-badge`);
    if (!glassdoorSection || !glassdoorResults) return;

    glassdoorSection.style.display = "block";
    glassdoorResults.innerHTML = `
      <div class="${EXTENSION_ID}-loading">
        <div class="${EXTENSION_ID}-spinner"></div>
        <span>Checking latest Workleap Glassdoor reviews…</span>
      </div>
    `;

    try {
      const reviews = await sendToBackground("GET_GLASSDOOR_REVIEWS", {});

      if (!reviews || reviews.length === 0) {
        glassdoorSection.style.display = "none";
        return;
      }

      if (countBadge) {
        countBadge.textContent = reviews.length;
        countBadge.style.display = "inline-flex";
      }

      glassdoorResults.innerHTML = reviews.map((r) => {
        const meta = [r.rating ? `${escapeHtml(r.rating)}/5` : "", r.date ? escapeHtml(r.date) : ""]
          .filter(Boolean)
          .join(" · ");

        return `
          <div class="${EXTENSION_ID}-glassdoor-item">
            <div class="${EXTENSION_ID}-glassdoor-item-header">
              <span class="${EXTENSION_ID}-glassdoor-badge">Glassdoor</span>
              ${meta ? `<span class="${EXTENSION_ID}-glassdoor-item-meta">${meta}</span>` : ""}
            </div>
            <div class="${EXTENSION_ID}-glassdoor-item-text">${escapeHtml(r.text)}</div>
          </div>
        `;
      }).join("");
    } catch (err) {
      console.error("[OV AI] Glassdoor search:", err);
      glassdoorResults.innerHTML = `
        <div class="${EXTENSION_ID}-glassdoor-item-error">⚠ ${escapeHtml(err.message)}</div>
      `;
    }
  }

  // ─── HR Research Insights (displayed inside the AI panel) ───────────────────

  async function searchHrInsights(feedbackText, panel) {
    const hrSection = panel.querySelector(`.${EXTENSION_ID}-hr-section`);
    const hrResults = panel.querySelector(`.${EXTENSION_ID}-hr-results`);
    const countBadge = panel.querySelector(`.${EXTENSION_ID}-hr-count-badge`);
    if (!hrSection || !hrResults) return;

    hrSection.style.display = "block";
    hrResults.innerHTML = `
      <div class="${EXTENSION_ID}-loading">
        <div class="${EXTENSION_ID}-spinner"></div>
        <span>Finding relevant HR research…</span>
      </div>
    `;

    try {
      const insights = await sendToBackground("GET_HR_INSIGHTS", { feedbackText });

      if (!insights || insights.length === 0) {
        hrSection.style.display = "none";
        return;
      }

      if (countBadge) {
        countBadge.textContent = insights.length;
        countBadge.style.display = "inline-flex";
      }

      hrResults.innerHTML = insights.map((item) => `
        <div class="${EXTENSION_ID}-hr-item">
          <div class="${EXTENSION_ID}-hr-item-header">
            <span class="${EXTENSION_ID}-hr-badge">${escapeHtml(item.source)}</span>
            <span class="${EXTENSION_ID}-hr-item-title">${escapeHtml(item.title)}</span>
          </div>
          <div class="${EXTENSION_ID}-hr-item-text">${escapeHtml(item.insight)}</div>
          ${item.relevance ? `
            <div class="${EXTENSION_ID}-hr-item-relevance">${escapeHtml(item.relevance)}</div>
          ` : ""}
        </div>
      `).join("");
    } catch (err) {
      console.error("[OV AI] HR insights:", err);
      hrResults.innerHTML = `
        <div class="${EXTENSION_ID}-hr-item-error">⚠ ${escapeHtml(err.message)}</div>
      `;
    }
  }

  // ─── AI Suggestion Panel ─────────────────────────────────────────────────────

  function createToneSelector() {
    const wrapper = document.createElement("div");
    wrapper.className = `${EXTENSION_ID}-tone-selector`;
    wrapper.innerHTML = `
      <span class="${EXTENSION_ID}-tone-label">Tone:</span>
      <button class="${EXTENSION_ID}-tone-btn active" data-tone="empathetic">Empathetic</button>
      <button class="${EXTENSION_ID}-tone-btn" data-tone="action_oriented">Action-Oriented</button>
      <button class="${EXTENSION_ID}-tone-btn" data-tone="appreciative">Appreciative</button>
      <button class="${EXTENSION_ID}-tone-btn" data-tone="investigative">Investigative</button>
      <button class="${EXTENSION_ID}-tone-btn" data-tone="shorter">Shorter</button>
    `;
    return wrapper;
  }

  function createAiPanel(feedbackText) {
    const panel = document.createElement("div");
    panel.className = `${EXTENSION_ID}-panel`;

    panel.innerHTML = `
      <div class="${EXTENSION_ID}-panel-header">
        <span class="${EXTENSION_ID}-panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          AI Response Suggestions
        </span>
        <button class="${EXTENSION_ID}-panel-close" title="Close">✕</button>
      </div>
      <div class="${EXTENSION_ID}-panel-body">
        <div class="${EXTENSION_ID}-tone-wrapper"></div>
        <div class="${EXTENSION_ID}-loading" style="display:none">
          <div class="${EXTENSION_ID}-spinner"></div>
          <span>Generating suggestion…</span>
        </div>
        <div class="${EXTENSION_ID}-suggestion-text"></div>
        <div class="${EXTENSION_ID}-context-used" style="display:none"></div>
        <div class="${EXTENSION_ID}-actions" style="display:none">
          <button class="${EXTENSION_ID}-copy-btn">Copy</button>
          <button class="${EXTENSION_ID}-use-btn">Use as reply ↗</button>
          <button class="${EXTENSION_ID}-regen-btn">↻ Regenerate</button>
        </div>

        <!-- Slack similarity section — auto-populated, hidden until results arrive -->
        <div class="${EXTENSION_ID}-slack-section" style="display:none">
          <div class="${EXTENSION_ID}-slack-section-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Related Slack Threads
            <span class="${EXTENSION_ID}-slack-count-badge" style="display:none"></span>
          </div>
          <div class="${EXTENSION_ID}-slack-results"></div>
        </div>

        <!-- Glassdoor review section — hidden until results arrive -->
        <div class="${EXTENSION_ID}-glassdoor-section" style="display:none">
          <div class="${EXTENSION_ID}-glassdoor-section-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L3 7v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V7l-9-5z"/>
            </svg>
            Latest Glassdoor Reviews · Workleap
            <span class="${EXTENSION_ID}-glassdoor-count-badge" style="display:none"></span>
          </div>
          <div class="${EXTENSION_ID}-glassdoor-results"></div>
        </div>

        <!-- HR research insights section — hidden until results arrive -->
        <div class="${EXTENSION_ID}-hr-section" style="display:none">
          <div class="${EXTENSION_ID}-hr-section-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            Recommended Resources
            <span class="${EXTENSION_ID}-hr-count-badge" style="display:none"></span>
          </div>
          <div class="${EXTENSION_ID}-hr-results"></div>
        </div>
      </div>
    `;

    panel.querySelector(`.${EXTENSION_ID}-tone-wrapper`).appendChild(createToneSelector());

    let selectedTone = "empathetic";

    panel.querySelectorAll(`.${EXTENSION_ID}-tone-btn`).forEach((btn) => {
      btn.addEventListener("click", () => {
        panel.querySelectorAll(`.${EXTENSION_ID}-tone-btn`).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTone = btn.dataset.tone;
        generate();
      });
    });

    panel.querySelector(`.${EXTENSION_ID}-panel-close`).addEventListener("click", () => panel.remove());

    const loadingEl    = panel.querySelector(`.${EXTENSION_ID}-loading`);
    const suggestionEl = panel.querySelector(`.${EXTENSION_ID}-suggestion-text`);
    const contextUsedEl = panel.querySelector(`.${EXTENSION_ID}-context-used`);
    const actionsEl    = panel.querySelector(`.${EXTENSION_ID}-actions`);
    const copyBtn      = panel.querySelector(`.${EXTENSION_ID}-copy-btn`);
    const useBtn       = panel.querySelector(`.${EXTENSION_ID}-use-btn`);
    const regenBtn     = panel.querySelector(`.${EXTENSION_ID}-regen-btn`);

    async function generate() {
      loadingEl.style.display = "flex";
      suggestionEl.textContent = "";
      contextUsedEl.style.display = "none";
      contextUsedEl.textContent = "";
      actionsEl.style.display = "none";
      try {
        const result = await sendToBackground("GENERATE_REPLY", { feedbackText, tone: selectedTone });
        const text = typeof result === "string" ? result : (result?.text || "");
        const contextUsed = Array.isArray(result?.contextUsed) ? result.contextUsed : [];
        suggestionEl.textContent = text;

        if (contextUsed.length > 0) {
          contextUsedEl.textContent = `Context used: ${contextUsed.join(", ")}`;
          contextUsedEl.style.display = "block";
        }

        actionsEl.style.display = "flex";
      } catch (err) {
        console.error("[OV AI] Generate suggestion:", err);
        suggestionEl.innerHTML = `<span class="${EXTENSION_ID}-error">⚠️ ${escapeHtml(err.message)}</span>`;
        contextUsedEl.style.display = "none";
      } finally {
        loadingEl.style.display = "none";
      }
    }

    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(suggestionEl.textContent).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
      });
    });

    // "Use as reply" — inject the suggestion into the reply textarea in the right panel.
    // Uses the React native setter trick so React's controlled input picks up the change.
    useBtn.addEventListener("click", () => {
      const textarea = document.querySelector(REPLY_TEXTAREA_SEL);
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        ).set;
        nativeSetter.call(textarea, suggestionEl.textContent);
        textarea.dispatchEvent(new Event("input",  { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        textarea.focus();
        useBtn.textContent = "Injected! ✓";
        setTimeout(() => (useBtn.textContent = "Use as reply ↗"), 2500);
      } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(suggestionEl.textContent);
        useBtn.textContent = "Copied to clipboard!";
        setTimeout(() => (useBtn.textContent = "Use as reply ↗"), 2500);
      }
    });

    regenBtn.addEventListener("click", generate);

    // Kick off AI generation, Slack search, Glassdoor, and HR insights in parallel
    generate();
    searchSlack(feedbackText, panel);
    searchGlassdoor(panel);
    searchHrInsights(feedbackText, panel);

    return panel;
  }


  // ─── Detail Panel Integration ─────────────────────────────────────────────────
  // Injects an "AI Reply" button next to the "Share" button in the conversation
  // header (right side). Falls back to the reply-control area if not found.

  function findShareBtn() {
    for (const sel of SHARE_BTN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function injectDetailPanelButton() {
    // Guard: already injected anywhere on the page
    if (document.querySelector(`.${EXTENSION_ID}-detail-btn`)) return;

    // Need at least a reply control to anchor the panel insertion
    const replyControl = document.querySelector(REPLY_CONTROL_SEL);
    if (!replyControl) return;

    // Get the feedback text from the open conversation
    const feedbackText = document.querySelector(DETAIL_MSG_SEL)?.textContent?.trim();
    if (!feedbackText || feedbackText.length < 3) return;

    const aiBtn = document.createElement("button");
    aiBtn.className = `${EXTENSION_ID}-suggest-btn ${EXTENSION_ID}-detail-btn`;
    aiBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
      AI Reply
    `;
    aiBtn.title = "Generate an AI-powered reply and search similar Slack messages";

    // Primary: place next to the Share button in the conversation header
    const shareBtn = findShareBtn();
    if (shareBtn) {
      shareBtn.insertAdjacentElement("afterend", aiBtn);
    } else {
      // Fallback: insert before Officevibe's own "Help me reply" button
      const helpBtn = replyControl.querySelector(REPLY_HELP_BTN_SEL);
      if (helpBtn && helpBtn.parentElement) {
        helpBtn.parentElement.insertBefore(aiBtn, helpBtn);
      } else {
        const secondary = replyControl.querySelector(
          ".feedback-conversation-reply-control__secondary-actions-container"
        );
        if (secondary) secondary.prepend(aiBtn);
        else replyControl.appendChild(aiBtn);
      }
    }

    let detailPanel = null;
    aiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (detailPanel && detailPanel.isConnected) {
        detailPanel.remove();
        detailPanel = null;
        return;
      }

      detailPanel = createAiPanel(feedbackText);
      // Mount as a fixed right-side drawer on the page body
      document.body.appendChild(detailPanel);
    });
  }

  // ─── Synthetic Slack Message Cards ───────────────────────────────────────────
  // Creates cards styled identically to Officevibe's conversation-summary-item-container
  // so Slack messages blend naturally into the feedback list.

  function createSlackCard({ author, text, date, channel }) {
    const outer = document.createElement("div");
    outer.className = `conversation-summary-item-container ${EXTENSION_ID}-slack-card`;
    outer.style.height = "123px";

    outer.innerHTML = `
      <div class="conversation-summary-item-container">
        <div class="${EXTENSION_ID}-slack-card-inner">
          <div class="${EXTENSION_ID}-slack-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Slack · #${escapeHtml(channel || "general")}
          </div>
          <div class="summary-message" data-hj-suppress="true">
            <span class="message-text">${escapeHtml(text)}</span>
          </div>
          <div class="summary-footer">
            <div class="message-author">
              <span class="author-name__ellipsis">${escapeHtml(author)}</span>
            </div>
            <div class="message-date">${escapeHtml(date)}</div>
          </div>
        </div>
      </div>
    `;

    return outer;
  }

  function injectSlackCards(messages) {
    const list = document.querySelector(VIRTUAL_LIST_SEL);
    if (!list || !messages || !messages.length) return;

    // Remove previous Slack cards first
    list.querySelectorAll(`.${EXTENSION_ID}-slack-card`).forEach((el) => el.remove());

    // Prepend Slack cards at the top of the list
    const fragment = document.createDocumentFragment();
    // Use forEach + prepend so order is preserved (first item ends up at top)
    [...messages].reverse().forEach((msg) => fragment.prepend(createSlackCard(msg)));
    list.prepend(fragment);
  }

  // Listen for Slack messages injected from the popup via chrome.runtime
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "INJECT_SLACK_CARDS" && message.payload) {
      injectSlackCards(message.payload.messages);
    }
  });

  // ─── Feedback Inbox Sidebar (Bulk Insights) ───────────────────────────────────

  function createInboxSidebar(feedbackItems) {
    const existing = document.getElementById(`${EXTENSION_ID}-sidebar`);
    if (existing) existing.remove();

    const sidebar = document.createElement("div");
    sidebar.id = `${EXTENSION_ID}-sidebar`;
    sidebar.className = `${EXTENSION_ID}-sidebar`;

    sidebar.innerHTML = `
      <div class="${EXTENSION_ID}-sidebar-header">
        <div class="${EXTENSION_ID}-sidebar-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          AI Feedback Insights
        </div>
        <div class="${EXTENSION_ID}-sidebar-actions">
          <button class="${EXTENSION_ID}-analyze-btn">Analyze All</button>
          <button class="${EXTENSION_ID}-sidebar-close">✕</button>
        </div>
      </div>
      <div class="${EXTENSION_ID}-sidebar-body">
        <p class="${EXTENSION_ID}-sidebar-hint">
          Found <strong>${feedbackItems.length}</strong> feedback item${feedbackItems.length !== 1 ? "s" : ""} on this page.
          Click <em>Analyze All</em> to get AI-powered insights and themes.
        </p>
        <div class="${EXTENSION_ID}-insights-container"></div>
      </div>
    `;

    sidebar.querySelector(`.${EXTENSION_ID}-sidebar-close`).addEventListener("click", () => sidebar.remove());

    const analyzeBtn        = sidebar.querySelector(`.${EXTENSION_ID}-analyze-btn`);
    const insightsContainer = sidebar.querySelector(`.${EXTENSION_ID}-insights-container`);

    analyzeBtn.addEventListener("click", async () => {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = "Analyzing…";
      insightsContainer.innerHTML = `
        <div class="${EXTENSION_ID}-loading">
          <div class="${EXTENSION_ID}-spinner"></div>
          <span>Analyzing feedback patterns…</span>
        </div>
      `;

      try {
        const texts = feedbackItems.map(extractFeedbackText).filter((t) => t.length > 10);
        const insights = await sendToBackground("SUMMARIZE_FEEDBACK", { feedbackItems: texts });
        renderInsights(insightsContainer, insights);
      } catch (err) {
        console.error("[OV AI] Summarize feedback:", err);
        insightsContainer.innerHTML = `<div class="${EXTENSION_ID}-error">⚠️ ${escapeHtml(err.message)}</div>`;
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Re-analyze";
      }
    });

    document.body.appendChild(sidebar);
    return sidebar;
  }

  function renderInsights(container, insights) {
    if (!insights || typeof insights !== "object") {
      container.innerHTML = `<p>${escapeHtml(String(insights))}</p>`;
      return;
    }

    let html = "";

    if (insights.summary) {
      html += `<div class="${EXTENSION_ID}-insight-section"><h4>Overview</h4><p>${escapeHtml(insights.summary)}</p></div>`;
    }
    if (insights.themes && insights.themes.length) {
      html += `<div class="${EXTENSION_ID}-insight-section"><h4>Key Themes</h4><ul>${insights.themes.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`;
    }
    if (insights.sentiment) {
      const { positive = 0, negative = 0, neutral = 0 } = insights.sentiment;
      html += `
        <div class="${EXTENSION_ID}-insight-section">
          <h4>Sentiment</h4>
          <div class="${EXTENSION_ID}-sentiment-bar">
            <div class="${EXTENSION_ID}-sentiment-pos" style="width:${positive}%"></div>
            <div class="${EXTENSION_ID}-sentiment-neu" style="width:${neutral}%"></div>
            <div class="${EXTENSION_ID}-sentiment-neg" style="width:${negative}%"></div>
          </div>
          <div class="${EXTENSION_ID}-sentiment-legend">
            <span class="pos">Positive ${positive}%</span>
            <span class="neu">Neutral ${neutral}%</span>
            <span class="neg">Negative ${negative}%</span>
          </div>
        </div>`;
    }
    if (insights.actionItems && insights.actionItems.length) {
      html += `<div class="${EXTENSION_ID}-insight-section"><h4>Priority Action Items</h4><ol>${insights.actionItems.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ol></div>`;
    }
    if (insights.notableQuotes && insights.notableQuotes.length) {
      html += `<div class="${EXTENSION_ID}-insight-section"><h4>Notable Feedback</h4>${insights.notableQuotes.map((q) => `<blockquote>"${escapeHtml(q)}"</blockquote>`).join("")}</div>`;
    }

    container.innerHTML = html;
  }

  // ─── Floating Action Button ──────────────────────────────────────────────────

  function createFloatingBtn() {
    if (document.getElementById(`${EXTENSION_ID}-fab`)) return;

    const fab = document.createElement("button");
    fab.id = `${EXTENSION_ID}-fab`;
    fab.className = `${EXTENSION_ID}-fab`;
    fab.title = "Open AI Feedback Assistant";
    fab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
    `;
    fab.addEventListener("click", () => createInboxSidebar(findFeedbackItems()));
    document.body.appendChild(fab);
  }

  // ─── Team Insights Scraper (/portal/team-insights) ───────────────────────────
  // Scrapes .metric-variation-block__label innerHTML and persists to storage.
  // Retries up to 5 times with 1.5s delays to handle async SPA rendering.

  function scrapeAndStoreMetrics(attempt = 0) {
    const blocks = document.querySelectorAll(METRIC_LABEL_SEL);
    if (!blocks.length) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreMetrics(attempt + 1), 1500);
      return;
    }
    // Store raw HTML, plain text, and the deep-link href for each metric
    const metrics = Array.from(blocks).map((el) => {
      // Walk up the DOM to find the nearest anchor — the metric cards are
      // typically wrapped in or adjacent to an <a> linking to the detail page.
      const anchor = el.closest("a[href]") || el.parentElement?.closest("a[href]");
      return {
        html: el.innerHTML,
        text: el.textContent.replace(/\s+/g, " ").trim(),
        href: anchor?.getAttribute("href") || null,
      };
    });
    chrome.storage.local.set({ [INSIGHTS_STORAGE_KEY]: metrics });
  }

  // ─── Compare Page Scraper (/portal/compare) ───────────────────────────────────
  // Scrapes metric scores from div.compare__content-container and persists them.

  function scrapeAndStoreCompareMetrics(attempt = 0) {
    const container = document.querySelector(".compare__content-container");
    if (!container) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreCompareMetrics(attempt + 1), 1500);
      return;
    }

    // Try known Officevibe/Workleap compare page metric selectors first,
    // then fall back to any direct child that contains a numeric value.
    const candidateSelectors = [
      '[class*="compare__metric"]',
      '[class*="metric-item"]',
      '[class*="score-block"]',
      '[class*="compare-card"]',
    ];

    let metricEls = [];
    for (const sel of candidateSelectors) {
      metricEls = Array.from(container.querySelectorAll(sel));
      if (metricEls.length) break;
    }

    if (!metricEls.length) {
      metricEls = Array.from(container.children).filter((el) => /\d/.test(el.textContent));
    }

    if (!metricEls.length) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreCompareMetrics(attempt + 1), 1500);
      return;
    }

    const entries = metricEls
      .map((el) => {
        const rawText = el.textContent.replace(/\s+/g, " ").trim();
        // Extract the first score-like number (1–100, possibly with one decimal)
        const scoreMatch = rawText.match(/\b(100(?:\.0+)?|[1-9]\d?(?:\.\d)?)\b/);
        const score = scoreMatch ? scoreMatch[1] : "";
        // Label = text with numbers and punctuation stripped
        const label = rawText
          .replace(/\b\d[\d.\s%/→←↑↓+\-]*\b/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        return { label, score, text: rawText.slice(0, 150) };
      })
      .filter((e) => e.text.length > 2);

    if (!entries.length) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreCompareMetrics(attempt + 1), 1500);
      return;
    }

    chrome.storage.local.set({ [COMPARE_METRICS_STORAGE_KEY]: entries });
  }

  // ─── Feedback Survey Scraper (/portal/feedback/survey) ───────────────────────
  // Captures the last 2 feedback entries: text, date, and read/unread status.

  function elapsedLabel(dateStr) {
    if (!dateStr) return "";
    // Already a relative phrase (e.g. "2 days ago", "Yesterday")
    if (/ago|yesterday|today|just now/i.test(dateStr)) return dateStr;
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return dateStr;
    const days = Math.floor((Date.now() - parsed) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return `${days} days ago`;
  }

  function scrapeAndStoreFeedbackEntries(attempt = 0) {
    const list = document.querySelector(VIRTUAL_LIST_SEL);
    if (!list) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreFeedbackEntries(attempt + 1), 1500);
      return;
    }

    const items = Array.from(list.children)
      .filter((el) => el.matches(CARD_OUTER_SEL) && el.querySelector(FEEDBACK_TEXT_SEL))
      .slice(0, 2);

    if (!items.length) {
      if (attempt < 5) setTimeout(() => scrapeAndStoreFeedbackEntries(attempt + 1), 1500);
      return;
    }

    const entries = items.map((el) => {
      const text = el.querySelector(FEEDBACK_TEXT_SEL)?.textContent?.trim() || "";
      const date = el.querySelector(".message-date")?.textContent?.trim() || "";
      // Try multiple common unread-indicator patterns
      const isUnread = !!(
        el.querySelector('[class*="unread"]') ||
        el.querySelector('[class*="new-indicator"]') ||
        el.querySelector('[class*="unseen"]') ||
        el.querySelector('[class*="notification-dot"]') ||
        el.querySelector('[class*="-new"]') ||
        el.classList.contains("unread")
      );
      return { text: text.slice(0, 140), date, isUnread, scrapedAt: Date.now() };
    });

    chrome.storage.local.set({ [FEEDBACK_SURVEY_STORAGE_KEY]: entries });
  }

  // ─── Recognition Gallery Scraper (/portal/recognition/gallery/public) ─────────
  // Counts cards with .recognition-card--public--not-seen and persists the count.

  function scrapeAndStoreUnseenRecognitions(attempt = 0) {
    const cards = document.querySelectorAll(RECOGNITION_NOT_SEEN_SEL);
    if (!cards.length && attempt < 5) {
      setTimeout(() => scrapeAndStoreUnseenRecognitions(attempt + 1), 1500);
      return;
    }
    chrome.storage.local.set({ [RECOGNITION_UNSEEN_STORAGE_KEY]: cards.length });
  }

  // ─── Home Page Insights Box (/portal/home) ────────────────────────────────────
  // Reads stored metric labels and injects them into .card.empty-checklist-card.

  function injectInsightsBox(attempt = 0) {
    if (document.getElementById(`${EXTENSION_ID}-insights-box`)) return;

    const card = document.querySelector(HOME_CARD_SEL);
    if (!card) {
      if (attempt < 5) setTimeout(() => injectInsightsBox(attempt + 1), 1500);
      return;
    }

    chrome.storage.local.get([INSIGHTS_STORAGE_KEY, COMPARE_METRICS_STORAGE_KEY, FEEDBACK_SURVEY_STORAGE_KEY, RECOGNITION_UNSEEN_STORAGE_KEY], (result) => {
      const raw = result[INSIGHTS_STORAGE_KEY];
      if (!raw || !raw.length) return;
      if (document.getElementById(`${EXTENSION_ID}-insights-box`)) return;

      // Normalise: old format was string[], new format is {html,text}[]
      const metrics = raw.map((m) =>
        typeof m === "string" ? { html: m, text: m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() } : m
      );

      const compareEntries     = result[COMPARE_METRICS_STORAGE_KEY] || [];
      const feedbackEntries    = result[FEEDBACK_SURVEY_STORAGE_KEY] || [];
      const unseenRecognitions = result[RECOGNITION_UNSEEN_STORAGE_KEY] ?? null;

      // Try to match each compare entry against a home metric by keyword overlap
      function findHomeMatch(compareEntry) {
        const words = (compareEntry.label || compareEntry.text)
          .toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return metrics.find((m) => words.some((w) => m.text.toLowerCase().includes(w))) || null;
      }

      const compareHtml = compareEntries.length ? `
        <div class="${EXTENSION_ID}-compare-section">
          <div class="${EXTENSION_ID}-compare-section-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Workleap Compare
          </div>
          ${compareEntries.map((entry) => {
            const match = findHomeMatch(entry);
            const changeText = match ? match.text : "";
            return `
              <div class="${EXTENSION_ID}-compare-row">
                <span class="${EXTENSION_ID}-compare-row-label">${escapeHtml(entry.label || entry.text.slice(0, 40))}</span>
                <div class="${EXTENSION_ID}-compare-row-right">
                  ${entry.score ? `<span class="${EXTENSION_ID}-compare-row-score">${escapeHtml(entry.score)}</span>` : ""}
                  ${changeText ? `<span class="${EXTENSION_ID}-compare-row-change">${escapeHtml(changeText)}</span>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>` : "";

      const feedbackHtml = feedbackEntries.length ? `
        <div class="${EXTENSION_ID}-feedback-section">
          <div class="${EXTENSION_ID}-feedback-section-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Recent Feedback
          </div>
          ${feedbackEntries.map((entry) => {
            const elapsed = elapsedLabel(entry.date);
            const readClass = entry.isUnread
              ? `${EXTENSION_ID}-feedback-status--unread`
              : `${EXTENSION_ID}-feedback-status--read`;
            const readLabel = entry.isUnread ? "Unread" : "Read";
            return `
              <div class="${EXTENSION_ID}-feedback-entry">
                <div class="${EXTENSION_ID}-feedback-entry-meta">
                  <span class="${EXTENSION_ID}-feedback-entry-date">${escapeHtml(entry.date)}</span>
                  ${elapsed && elapsed !== entry.date ? `<span class="${EXTENSION_ID}-feedback-entry-elapsed">· ${escapeHtml(elapsed)}</span>` : ""}
                  <span class="${readClass}">${readLabel}</span>
                </div>
                <p class="${EXTENSION_ID}-feedback-entry-text">${escapeHtml(entry.text)}</p>
              </div>`;
          }).join("")}
        </div>` : "";

      const box = document.createElement("div");
      box.id = `${EXTENSION_ID}-insights-box`;
      box.className = `${EXTENSION_ID}-insights-box`;
      box.innerHTML = `
        <div class="${EXTENSION_ID}-insights-box-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18"/>
            <path d="M7 16l4-4 4 4 4-4"/>
          </svg>
          Engagement Score Changes
        </div>
        <ul class="${EXTENSION_ID}-insights-box-list">
          ${metrics.map((m) => m.href
            ? `<li><a href="${escapeHtml(m.href)}" class="${EXTENSION_ID}-metric-link">${m.html}</a></li>`
            : `<li>${m.html}</li>`
          ).join("")}
        </ul>
        ${compareHtml}
        ${unseenRecognitions !== null ? (unseenRecognitions === 0
          ? `<p class="${EXTENSION_ID}-recognition-all-seen">All recognitions seen</p>`
          : `<div class="${EXTENSION_ID}-recognition-unseen-row">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              <span class="${EXTENSION_ID}-recognition-unseen-label">Unseen recognitions</span>
              <span class="${EXTENSION_ID}-recognition-unseen-badge">${unseenRecognitions}</span>
            </div>`)
          : ""}
        ${feedbackHtml}
        <div class="${EXTENSION_ID}-insights-ai-section">
          <div class="${EXTENSION_ID}-insights-ai-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
            AI Recommended Actions
          </div>
          <div class="${EXTENSION_ID}-insights-ai-body">
            <div class="${EXTENSION_ID}-loading">
              <div class="${EXTENSION_ID}-spinner"></div>
              <span>Analyzing score changes…</span>
            </div>
          </div>
        </div>
      `;

      card.innerHTML = "";
      card.appendChild(box);

      // Ask Claude to analyze the metric changes and suggest actions.
      // Include compare page scores (absolute values) alongside the change indicators.
      const metricTexts = [
        ...metrics.map((m) => m.text),
        ...compareEntries.map((e) => e.label && e.score ? `${e.label}: ${e.score}` : e.text),
      ];
      sendToBackground("ANALYZE_ENGAGEMENT_METRICS", { metricTexts })
        .then((analysis) => {
          const aiBody = box.querySelector(`.${EXTENSION_ID}-insights-ai-body`);
          if (!aiBody) return;

          let html = "";
          if (analysis.summary) {
            html += `<p class="${EXTENSION_ID}-insights-ai-summary">${escapeHtml(analysis.summary)}</p>`;
          }
          const actions = (analysis.actions || []).slice(0, 2);
          if (actions.length) {
            html += actions.map((a, i) => {
              const text     = typeof a === "string" ? a : (a.text || "");
              const deadline = typeof a === "string" ? "" : (a.deadline || "");
              const deadlineMs  = deadline ? new Date(deadline).getTime() : NaN;
              const daysLeft    = isNaN(deadlineMs) ? null : Math.ceil((deadlineMs - Date.now()) / 86_400_000);
              const countdownLabel = daysLeft === null ? ""
                : daysLeft > 0  ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`
                : daysLeft === 0 ? "Due today"
                : `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""} overdue`;
              const countdownClass = daysLeft !== null && daysLeft <= 2
                ? `${EXTENSION_ID}-action-countdown ${EXTENSION_ID}-action-countdown--urgent`
                : `${EXTENSION_ID}-action-countdown`;

              return `
                <label class="${EXTENSION_ID}-action-item">
                  <input type="checkbox" class="${EXTENSION_ID}-action-checkbox" data-action-index="${i}">
                  <div class="${EXTENSION_ID}-action-content">
                    <span class="${EXTENSION_ID}-action-text">${escapeHtml(text)}</span>
                    ${deadline ? `
                      <div class="${EXTENSION_ID}-action-deadline-row">
                        <span class="${EXTENSION_ID}-action-deadline-date">${escapeHtml(deadline)}</span>
                        ${countdownLabel ? `<span class="${countdownClass}">${escapeHtml(countdownLabel)}</span>` : ""}
                      </div>` : ""}
                  </div>
                </label>`;
            }).join("");
          }
          aiBody.innerHTML = html || "<p>No suggestions generated.</p>";

          // Persist checkbox state across page loads
          const storageKey = `${EXTENSION_ID}_action_checks`;
          chrome.storage.local.get([storageKey], (res) => {
            const saved = res[storageKey] || {};
            aiBody.querySelectorAll(`.${EXTENSION_ID}-action-checkbox`).forEach((cb) => {
              const idx = cb.dataset.actionIndex;
              if (saved[idx]) cb.checked = true;
              cb.addEventListener("change", () => {
                chrome.storage.local.get([storageKey], (r) => {
                  const state = r[storageKey] || {};
                  state[idx] = cb.checked;
                  chrome.storage.local.set({ [storageKey]: state });
                });
              });
            });
          });
        })
        .catch((err) => {
          console.error("[OV AI] Engagement metrics:", err);
          const aiBody = box.querySelector(`.${EXTENSION_ID}-insights-ai-body`);
          if (aiBody) {
            aiBody.innerHTML = `<span class="${EXTENSION_ID}-error">⚠ ${escapeHtml(err.message)}</span>`;
          }
        });
    });
  }

  // ─── Recognition Suggestions (below the recognition call-to-action link) ─────
  // Searches Slack for the last 2 days, surfaces accomplishments worth a good vibe.

  function findRecognitionLink() {
    const links = document.querySelectorAll(RECOGNITION_LINK_SEL);
    for (const link of links) {
      const href = (link.getAttribute("href") || "").toLowerCase();
      const text = link.textContent.toLowerCase();
      if (href.includes("recogni") || text.includes("recogni")) return link;
    }
    return null;
  }

  function injectRecognitionSuggestions(attempt = 0) {
    if (document.getElementById(`${EXTENSION_ID}-recognition-suggestions`)) return;

    const link = findRecognitionLink();
    if (!link) {
      if (attempt < 5) setTimeout(() => injectRecognitionSuggestions(attempt + 1), 1500);
      return;
    }

    const panel = document.createElement("div");
    panel.id = `${EXTENSION_ID}-recognition-suggestions`;
    panel.className = `${EXTENSION_ID}-recognition-panel`;
    panel.innerHTML = `
      <div class="${EXTENSION_ID}-recognition-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        Recognition ideas · last 2 days in Slack
      </div>
      <div class="${EXTENSION_ID}-recognition-body">
        <div class="${EXTENSION_ID}-loading">
          <div class="${EXTENSION_ID}-spinner"></div>
          <span>Scanning Slack for wins…</span>
        </div>
      </div>
    `;

    link.insertAdjacentElement("afterend", panel);

    sendToBackground("FETCH_RECOGNITION_SUGGESTIONS", {})
      .then((suggestions) => {
        const body = panel.querySelector(`.${EXTENSION_ID}-recognition-body`);
        if (!body) return;

        if (!suggestions || !suggestions.length) {
          body.innerHTML = `<p class="${EXTENSION_ID}-recognition-empty">No standout wins found in the last 2 days.</p>`;
          return;
        }

        body.innerHTML = suggestions.map((s) => `
          <div class="${EXTENSION_ID}-recognition-item">
            <div class="${EXTENSION_ID}-recognition-item-meta">
              <span class="${EXTENSION_ID}-recognition-item-who">${escapeHtml(s.who)}</span>
              ${s.channel ? `<span class="${EXTENSION_ID}-recognition-channel-badge">${escapeHtml(s.channel)}</span>` : ""}
            </div>
            <div class="${EXTENSION_ID}-recognition-item-achievement">${escapeHtml(s.achievement)}</div>
            <div class="${EXTENSION_ID}-recognition-item-vibe">${escapeHtml(s.vibe)}</div>
          </div>
        `).join("");
      })
      .catch((err) => {
        console.error("[OV AI] Recognition suggestions:", err);
        const body = panel.querySelector(`.${EXTENSION_ID}-recognition-body`);
        if (body) {
          body.innerHTML = `<span class="${EXTENSION_ID}-error">⚠ ${escapeHtml(err.message)}</span>`;
        }
      });
  }

  // ─── Take Survey — Last Response Info ────────────────────────────────────────
  // Injects a small "last responded X days ago" note below the take-survey button.

  const LAST_SURVEY_DATE = new Date("2026-02-10");

  function injectLastSurveyInfo(attempt = 0) {
    if (document.getElementById(`${EXTENSION_ID}-last-survey-info`)) return;

    const box = document.querySelector(TAKE_SURVEY_BOX_SEL);
    if (!box) {
      if (attempt < 5) setTimeout(() => injectLastSurveyInfo(attempt + 1), 1500);
      return;
    }

    const btn = box.querySelector("button");
    if (!btn) {
      if (attempt < 5) setTimeout(() => injectLastSurveyInfo(attempt + 1), 1500);
      return;
    }

    const diffDays = Math.floor((Date.now() - LAST_SURVEY_DATE) / 86_400_000);

    const info = document.createElement("p");
    info.id = `${EXTENSION_ID}-last-survey-info`;
    info.className = `${EXTENSION_ID}-last-survey-info`;
    info.textContent = `Last responded Feb 10, 2026 · ${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;

    btn.insertAdjacentElement("afterend", info);
  }

  // ─── Main Initialization & Observer ─────────────────────────────────────────

  const debouncedInject = debounce(() => {
    injectDetailPanelButton();
  }, 600);

  function init() {
    const path = location.pathname;

    if (path.includes("/portal/home")) {
      injectInsightsBox();
      injectLastSurveyInfo();
      injectRecognitionSuggestions();
    }

    if (path.includes("/portal/team-insights")) {
      scrapeAndStoreMetrics();
    }

    if (path.includes("/portal/compare")) {
      scrapeAndStoreCompareMetrics();
    }

    if (path.includes("/portal/feedback/survey")) {
      scrapeAndStoreFeedbackEntries();
    }

    if (path.includes("/portal/recognition/gallery/public")) {
      scrapeAndStoreUnseenRecognitions();
    }

    createFloatingBtn();
    injectDetailPanelButton();

    if (listObserver) listObserver.disconnect();

    listObserver = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) {
        debouncedInject();
        createFloatingBtn();
      }
    });

    listObserver.observe(document.body, { childList: true, subtree: true });
  }

  // SPA route change detection
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(init, 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  // Initial run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
