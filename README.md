# Officevibe AI Assistant

A Chrome extension (Manifest V3) that injects AI-powered tools directly into [Officevibe / Workleap](https://officevibe.workleap.com) to help managers respond to employee feedback faster and more thoughtfully.

---

## Features

- **AI reply suggestions** — One-click generation of empathetic, context-aware replies to anonymous employee feedback
- **Multiple response tones** — Choose from empathetic, action-oriented, direct, and more
- **MBTI-personalized responses** — Optionally set your personality type so suggestions match your natural communication style
- **Bulk feedback analysis** — Summarise a full page of feedback into key themes, sentiment breakdown, and priority action items
- **Similar Slack discussions** — Automatically surfaces relevant past Slack conversations that relate to each piece of feedback
- **Glassdoor context** — Pulls recent public Glassdoor reviews for Workleap to give additional context when crafting replies
- **Team insights analysis** — AI-generated summary of engagement metric changes visible on the Officevibe home and compare pages
- **Recognition suggestions** — Scans configured Slack channels for recent wins and drafts recognition posts

---

## Requirements

- Google Chrome (or any Chromium browser)
- An [Anthropic API key](https://console.anthropic.com) (required)
- Slack session or OAuth token (optional — enables the Slack similarity search feature)

---

## Installation

This extension is not published on the Chrome Web Store. Load it manually as an unpacked extension.

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/officevibe-ai-assistant.git
   cd officevibe-ai-assistant
   ```

2. **Create your config file**

   ```bash
   cp config.example.js config.js
   ```

   Open `config.js` and fill in your Slack tokens and channel IDs (see [Configuration](#configuration) below). The Anthropic API key is set through the extension popup, not here.

3. **Load the extension in Chrome**

   - Navigate to `chrome://extensions`
   - Enable **Developer mode** (toggle in the top-right)
   - Click **Load unpacked**
   - Select the cloned project folder

4. **Set your API key**

   - Click the extension icon in the Chrome toolbar
   - Paste your Anthropic API key
   - Select a Claude model (see [Model Options](#model-options))
   - Optionally select your MBTI type
   - Click **Save Settings**

5. **Navigate to Officevibe**

   Go to `https://officevibe.workleap.com` and open any feedback conversation — the AI buttons will appear automatically.

---

## Configuration

### `config.js` (git-ignored)

Copy `config.example.js` to `config.js` and edit the following:

| Key | Description |
|-----|-------------|
| `SLACK_XOXC_TOKEN` | Slack web session token (`xoxc-…`), found in Slack network requests |
| `SLACK_XOXD_TOKEN` | Slack device cookie token (`xoxd-…`), found in browser cookies on `slack.com` |
| `RECOGNITION_CHANNELS` | Array of Slack channel IDs to scan for recognition-worthy wins |

> **Finding Slack tokens:** Open Slack in your browser, open DevTools → Network, perform a search, and look for requests to `slack.com/api/` — the `token` field in the request body is your `xoxc-` token. The `xoxd-` token is in Application → Cookies → `d`.

> **Standard OAuth token:** If you have a Slack app with `search:read` permission, you can use an `xoxb-` or `xoxp-` token instead. The extension detects the token type automatically.

### Popup settings

| Setting | Description |
|---------|-------------|
| Anthropic API Key | Your key from [console.anthropic.com](https://console.anthropic.com) — stored locally in Chrome sync storage |
| Claude Model | Which model to use for all AI calls (see below) |
| MBTI Type | Optional — tailors the tone of AI suggestions to your personality type |

---

## Model Options

| Model | Speed | Cost | Best for |
|-------|-------|------|----------|
| Haiku 4.5 | Fastest | Cheapest | High-volume use, quick suggestions |
| Sonnet 4.6 | Balanced | Moderate | Default — good quality at reasonable cost |
| Opus 4.6 | Slowest | Most expensive | Complex feedback, highest quality replies |

The selected model is saved in Chrome sync storage and used for all AI calls.

---

## File Structure

```
officevibe-ai-assistant/
├── manifest.json          # MV3 manifest — permissions and entry points
├── background.js          # Service worker — Claude API calls, Slack search, Glassdoor fetch
├── content.js             # Content script — DOM detection, button injection, sidebar UI
├── popup.html             # Extension popup — settings UI
├── popup.js               # Popup logic — load/save settings
├── styles.css             # All injected UI styles (prefixed with --ov-ai-)
├── config.js              # Local credentials (git-ignored — see config.example.js)
├── config.example.js      # Credentials template
├── generate-icons.js      # Node script to regenerate PNG icons via canvas
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Privacy

- Your Anthropic API key is stored locally in Chrome's sync storage and never sent anywhere except directly to `api.anthropic.com`
- Feedback text is sent to the Claude API only when you explicitly click an AI button — nothing is processed passively
- Slack tokens are stored in `config.js` on your local machine only
- No analytics, no external tracking

---

## Regenerating Icons

The icons are pre-built PNGs. If you want to regenerate them:

```bash
npm install canvas
node generate-icons.js
```

---

## Compatibility

Tested on `officevibe.workleap.com`. The extension uses DOM selectors tuned to Officevibe's current markup — if Workleap updates their UI, selectors in `content.js` may need adjustment.
