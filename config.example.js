// ─── Extension Configuration ──────────────────────────────────────────────────
// Copy this file to config.js and fill in your own values.
// config.js is git-ignored — never commit real tokens.

const CONFIG = {

  // ─── Claude API ──────────────────────────────────────────────────────────────
  CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
  CLAUDE_MODEL:   "claude-sonnet-4-6",   // fallback if no model selected in popup

  // ─── Slack Tokens ─────────────────────────────────────────────────────────────
  // Option A — Session tokens from your browser's Slack session (xoxc- + xoxd-):
  //   xoxc-  found in Slack web app network requests (Authorization header)
  //   xoxd-  found in browser cookies as the "d" cookie on slack.com
  // Option B — Standard OAuth bot/user token (xoxb- / xoxp-):
  //   Obtainable from api.slack.com/apps after creating a Slack app with
  //   search:read permission.

  /* Lookup SLACK_MCP_XOXC_TOKEN
Open your browser's Developer Console.
In Firefox, under Tools -> Browser Tools -> Web Developer tools in the menu bar
In Chrome, click the "three dots" button to the right of the URL Bar, then select More Tools -> Developer Tools
Switch to the console tab.
Type "allow pasting" and press ENTER.
Paste the following snippet and press ENTER to execute: JSON.parse(localStorage.localConfig_v2).teams[document.location.pathname.match(/^\/client\/([A-Z0-9]+)/)[1]].token
Token value is printed right after the executed command (it starts with xoxc-), save it somewhere for now.

Lookup SLACK_MCP_XOXD_TOKEN
Switch to "Application" tab and select "Cookies" in the left navigation pane.
Find the cookie with the name d. That's right, just the letter d.
Double-click the Value of this cookie.
Press Ctrl+C or Cmd+C to copy it's value to clipboard.
Save it for later.
*/
  SLACK_XOXC_TOKEN: "xoxc-YOUR-TOKEN-HERE",
  SLACK_XOXD_TOKEN: "xoxd-YOUR-TOKEN-HERE",

  // ─── Recognition: Slack channels to scan for wins ────────────────────────────
  // Replace with your own workspace channel IDs (Settings → copy link → extract ID).
  RECOGNITION_CHANNELS: [
    "C000000000",
  ],

  // ─── Team Members: Slack user IDs to track for "Your team's activity" ────────
  // Add the Slack user IDs of your direct reports or key team members.
  // User IDs look like "U012AB3CD" — find them by clicking a member's profile
  // in Slack and selecting "Copy member ID" from the ⋮ menu.
  TEAM_MEMBER_IDS: [
    "U000000000",
  ],

  // ─── MBTI Communication Styles ───────────────────────────────────────────────
  MBTI_STYLES: {
    INTJ: "direct, strategic, and concise — leads with logic and long-term vision, minimal small talk",
    INTP: "analytical and precise — focuses on root causes and systemic understanding, open to exploring ideas",
    ENTJ: "decisive and structured — sets clear expectations with confident, forward-moving language",
    ENTP: "energetic and idea-driven — asks thought-provoking questions, comfortable with brainstorming openly",
    INFJ: "thoughtful and values-driven — connects feedback to purpose, uses meaningful and careful language",
    INFP: "gentle and authentic — leads with empathy and personal values, avoids overly corporate tone",
    ENFJ: "warm and inspiring — focuses on the person, offers encouragement while addressing the issue",
    ENFP: "enthusiastic and supportive — acknowledges feelings openly, keeps the tone optimistic and human",
    ISTJ: "reliable and fact-based — references specific details, commits to clear follow-through steps",
    ISFJ: "caring and dependable — shows genuine concern, offers steady and practical reassurance",
    ESTJ: "organized and no-nonsense — gets to the point with clear action items and accountability",
    ESFJ: "personable and supportive — emphasizes team harmony, validates feelings before problem-solving",
    ISTP: "calm and pragmatic — cuts to practical solutions without over-explaining, respects autonomy",
    ISFP: "humble and empathetic — responds gently with a focus on individual well-being, avoids rigidity",
    ESTP: "straightforward and action-oriented — addresses issues head-on with energy and practical fixes",
    ESFP: "friendly and approachable — keeps the tone light and positive while still being genuine",
  },

};
