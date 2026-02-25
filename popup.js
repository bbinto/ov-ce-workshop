// Popup script — manages API key configuration

const apiKeyInput     = document.getElementById("apiKeyInput");
const toggleBtn       = document.getElementById("toggleVisibility");
const modelSelect     = document.getElementById("modelSelect");
const mbtiSelect      = document.getElementById("mbtiSelect");
const saveBtn         = document.getElementById("saveBtn");
const statusBanner    = document.getElementById("statusBanner");

// ─── Load saved settings on popup open ────────────────────────────────────

chrome.storage.sync.get(["anthropicApiKey", "claudeModel", "mbtiType"], (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
    showApiStatus("has-key");
  } else {
    showApiStatus("no-key");
  }

  modelSelect.value = result.claudeModel || "claude-sonnet-4-6";

  if (result.mbtiType) {
    mbtiSelect.value = result.mbtiType;
  }
});

// ─── Status helpers ────────────────────────────────────────────────────────

function showApiStatus(state) {
  if (state === "has-key") {
    statusBanner.className   = "status-banner has-key";
    statusBanner.textContent = "✓ API key configured — AI features are active";
  } else {
    statusBanner.className   = "status-banner no-key";
    statusBanner.textContent = "⚠ No API key set — enter your Anthropic key below";
  }
}

// ─── Toggle key visibility ─────────────────────────────────────────────────

let apiVisible = false;

toggleBtn.addEventListener("click", () => {
  apiVisible = !apiVisible;
  apiKeyInput.type = apiVisible ? "text" : "password";
  toggleBtn.querySelector("svg").innerHTML = apiVisible
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// ─── Save settings ─────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const apiKey     = apiKeyInput.value.trim();
  const claudeModel = modelSelect.value;
  const mbtiType   = mbtiSelect.value;

  if (!apiKey) {
    flashError("Please enter an Anthropic API key");
    return;
  }

  if (!apiKey.startsWith("sk-ant-")) {
    flashError("Invalid Anthropic key format");
    return;
  }

  const toSave = { anthropicApiKey: apiKey, claudeModel };

  if (mbtiType) {
    toSave.mbtiType = mbtiType;
  } else {
    chrome.storage.sync.remove("mbtiType");
  }

  chrome.storage.sync.set(toSave, () => {
    saveBtn.textContent  = "Saved!";
    saveBtn.className    = "save-btn success";
    showApiStatus("has-key");
    setTimeout(() => {
      saveBtn.textContent = "Save Settings";
      saveBtn.className   = "save-btn";
    }, 2000);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function flashError(msg) {
  saveBtn.textContent       = msg;
  saveBtn.style.background  = "#ef4444";
  setTimeout(() => {
    saveBtn.textContent      = "Save Settings";
    saveBtn.style.background = "";
  }, 2200);
}

// ─── Keyboard shortcut: Enter to save ─────────────────────────────────────

apiKeyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
