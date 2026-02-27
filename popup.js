// Popup script — manages API provider configuration

const providerSelect  = document.getElementById("providerSelect");
const claudeSettings  = document.getElementById("claude-settings");
const geminiSettings  = document.getElementById("gemini-settings");

const apiKeyInput     = document.getElementById("apiKeyInput");
const toggleBtn       = document.getElementById("toggleVisibility");
const modelSelect     = document.getElementById("modelSelect");

const geminiKeyInput  = document.getElementById("geminiKeyInput");
const toggleGeminiKey = document.getElementById("toggleGeminiKey");
const geminiModelSelect = document.getElementById("geminiModelSelect");

const mbtiSelect      = document.getElementById("mbtiSelect");
const saveBtn         = document.getElementById("saveBtn");
const statusBanner    = document.getElementById("statusBanner");

// ─── Load saved settings on popup open ────────────────────────────────────

chrome.storage.sync.get(
  ["anthropicApiKey", "claudeModel", "mbtiType", "llmProvider", "geminiApiKey", "geminiModel"],
  (result) => {
    if (result.anthropicApiKey) apiKeyInput.value = result.anthropicApiKey;
    modelSelect.value = result.claudeModel || "claude-sonnet-4-6";

    if (result.geminiApiKey) geminiKeyInput.value = result.geminiApiKey;
    geminiModelSelect.value = result.geminiModel || "gemini-2.5-flash";

    if (result.mbtiType) mbtiSelect.value = result.mbtiType;

    const provider = result.llmProvider || "claude";
    providerSelect.value = provider;
    applyProvider(provider, result);
  }
);

// ─── Provider switching ────────────────────────────────────────────────────

function applyProvider(provider, stored = {}) {
  const isGemini = provider === "gemini";
  claudeSettings.style.display = isGemini ? "none" : "";
  geminiSettings.style.display = isGemini ? "" : "none";

  if (isGemini) {
    const hasKey = !!(stored.geminiApiKey || geminiKeyInput.value.trim());
    showStatus(hasKey ? "has-key" : "no-key", "Gemini");
  } else {
    const hasKey = !!(stored.anthropicApiKey || apiKeyInput.value.trim());
    showStatus(hasKey ? "has-key" : "no-key", "Claude");
  }
}

providerSelect.addEventListener("change", () => {
  applyProvider(providerSelect.value);
});

// ─── Status helpers ────────────────────────────────────────────────────────

function showStatus(state, provider) {
  if (state === "has-key") {
    statusBanner.className   = "status-banner has-key";
    statusBanner.textContent = `✓ ${provider} API key configured — AI features are active`;
  } else {
    statusBanner.className   = "status-banner no-key";
    statusBanner.textContent = `⚠ No ${provider} API key set — enter your key below`;
  }
}

// ─── Toggle Claude key visibility ─────────────────────────────────────────

let claudeKeyVisible = false;

toggleBtn.addEventListener("click", () => {
  claudeKeyVisible = !claudeKeyVisible;
  apiKeyInput.type = claudeKeyVisible ? "text" : "password";
  toggleBtn.querySelector("svg").innerHTML = claudeKeyVisible
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// ─── Toggle Gemini key visibility ──────────────────────────────────────────

let geminiKeyVisible = false;

toggleGeminiKey.addEventListener("click", () => {
  geminiKeyVisible = !geminiKeyVisible;
  geminiKeyInput.type = geminiKeyVisible ? "text" : "password";
  toggleGeminiKey.querySelector("svg").innerHTML = geminiKeyVisible
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// ─── Save settings ─────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const mbtiType = mbtiSelect.value;
  const toSave   = { llmProvider: provider };

  if (provider === "claude") {
    const apiKey      = apiKeyInput.value.trim();
    const claudeModel = modelSelect.value;
    if (!apiKey) { flashError("Please enter an Anthropic API key"); return; }
    if (!apiKey.startsWith("sk-ant-")) { flashError("Invalid Anthropic key format"); return; }
    toSave.anthropicApiKey = apiKey;
    toSave.claudeModel     = claudeModel;
  } else {
    const geminiKey   = geminiKeyInput.value.trim();
    const geminiModel = geminiModelSelect.value;
    if (!geminiKey) { flashError("Please enter a Gemini API key"); return; }
    if (!geminiKey.startsWith("AIza")) { flashError("Invalid Gemini key format"); return; }
    toSave.geminiApiKey = geminiKey;
    toSave.geminiModel  = geminiModel;
  }

  if (mbtiType) {
    toSave.mbtiType = mbtiType;
  } else {
    chrome.storage.sync.remove("mbtiType");
  }

  chrome.storage.sync.set(toSave, () => {
    saveBtn.textContent = "Saved!";
    saveBtn.className   = "save-btn success";
    showStatus("has-key", provider === "gemini" ? "Gemini" : "Claude");
    setTimeout(() => {
      saveBtn.textContent = "Save Settings";
      saveBtn.className   = "save-btn";
    }, 2000);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function flashError(msg) {
  saveBtn.textContent      = msg;
  saveBtn.style.background = "#ef4444";
  setTimeout(() => {
    saveBtn.textContent      = "Save Settings";
    saveBtn.style.background = "";
  }, 2200);
}

// ─── Keyboard shortcut: Enter to save ─────────────────────────────────────

apiKeyInput.addEventListener("keydown",   (e) => { if (e.key === "Enter") saveBtn.click(); });
geminiKeyInput.addEventListener("keydown",(e) => { if (e.key === "Enter") saveBtn.click(); });
