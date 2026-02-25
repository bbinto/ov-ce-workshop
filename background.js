// Background service worker — handles Claude API calls and Slack searches

importScripts("config.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GENERATE_SUGGESTION") {
    handleGenerateSuggestion(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true; // keep channel open for async response
  }

  if (message.type === "GENERATE_REPLY") {
    handleGenerateReply(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "SUMMARIZE_FEEDBACK") {
    handleSummarizeFeedback(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "SEARCH_SLACK_SIMILAR") {
    handleSearchSlackSimilar(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "GET_GLASSDOOR_REVIEWS") {
    handleGetGlassdoorReviews()
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "GET_HR_INSIGHTS") {
    handleGetHrInsights(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "ANALYZE_ENGAGEMENT_METRICS") {
    handleAnalyzeEngagementMetrics(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (message.type === "FETCH_RECOGNITION_SUGGESTIONS") {
    handleFetchRecognitionSuggestions()
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => { console.error("[OV AI]", err); sendResponse({ success: false, error: err.message }); });
    return true;
  }
});

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["anthropicApiKey", "claudeModel"], (result) => {
      resolve({
        key:   result.anthropicApiKey || null,
        model: result.claudeModel || CONFIG.CLAUDE_MODEL,
      });
    });
  });
}

async function getMbtiType() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["mbtiType"], (result) => {
      resolve(result.mbtiType || null);
    });
  });
}

async function getSlackToken() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["slackToken"], (result) => {
      resolve(result.slackToken || CONFIG.SLACK_XOXC_TOKEN);
    });
  });
}

// ─── AI API (Claude) ───────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userContent) {
  const { key: apiKey, model } = await getApiKey();

  if (!apiKey) {
    throw new Error("No API key configured. Please set your Anthropic API key in the extension settings.");
  }

  const response = await fetch(CONFIG.CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ─── Slack Helpers ────────────────────────────────────────────────────────────

// Extract up to 6 meaningful keywords from feedback text for the Slack query.
// Strips stop words and punctuation; returns a space-joined string.
function extractKeywords(text) {
  const stopWords = new Set([
    "i","a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","are","was","were","be","been","have","has","had","do","does","did",
    "not","no","this","that","it","its","we","our","my","me","he","she","they",
    "you","your","their","there","here","what","how","when","where","why","who",
    "feel","like","very","just","also","so","get","can","could","would","should",
    "will","more","some","any","all","about","up","out","from","as","if","then",
    "want","think","dont","really","much","too","even","still","need","know",
    "make","time","way","work","good","great","bit","lot","sure","feel","feels",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 6)
    .join(" ");
}

// Strip Slack mrkdwn markup: <@U123>, <#C123|channel>, <http://...>, *bold*, _italic_
function stripSlackMarkup(text) {
  return (text || "")
    .replace(/<@[^>]+>/g, "@user")
    .replace(/<#[^|>]+\|([^>]+)>/g, "#$1")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

// Format a Slack timestamp (e.g. "1706789012.345678") to a readable date string.
function formatSlackTs(ts) {
  if (!ts) return "";
  const ms = parseFloat(ts) * 1000;
  if (isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Parse and normalize a date string into a readable short date.
function formatReviewDate(rawDate) {
  if (!rawDate) return "";
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Fetch latest public Glassdoor reviews for Workleap and return a compact list.
// Best-effort scraping: returns [] if Glassdoor blocks the request or structure changed.
async function fetchLatestGlassdoorReviews() {
  const candidateUrls = [
    "https://www.glassdoor.com/Reviews/Workleap-Reviews-E8046838.htm",
    "https://www.glassdoor.com/Reviews/Officevibe-Reviews-E8046838.htm",
    "https://www.glassdoor.com/Reviews/GSoft-Reviews-E8046838.htm",
  ];

  let html = "";
  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (response.ok) {
        html = await response.text();
        if (html && html.length > 1000) break;
      }
    } catch {
      // Try next candidate URL
    }
  }

  if (!html) return [];

  // Try extracting JSON-LD reviews first
  const jsonLdMatches = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  );

  const collected = [];

  for (const match of jsonLdMatches) {
    const rawJson = (match[1] || "").trim();
    if (!rawJson) continue;

    try {
      const parsed = JSON.parse(rawJson);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const reviews = node?.review;
        if (!reviews) continue;
        const reviewArr = Array.isArray(reviews) ? reviews : [reviews];
        for (const r of reviewArr) {
          const text = (r?.reviewBody || "").replace(/\s+/g, " ").trim();
          const rating = r?.reviewRating?.ratingValue;
          const date = formatReviewDate(r?.datePublished);
          if (text) {
            collected.push({
              text: text.slice(0, 240),
              rating: rating ? String(rating) : "",
              date,
            });
          }
        }
      }
    } catch {
      // Ignore invalid JSON-LD block
    }
  }

  if (collected.length > 0) return collected.slice(0, 3);

  // Fallback extraction from raw html snippets if JSON-LD is unavailable.
  const snippets = Array.from(html.matchAll(/"reviewBody"\s*:\s*"([^\"]{20,500})"/g))
    .map((m) => m[1]
      .replace(/\\u003C[^>]*\\u003E/g, " ")
      .replace(/\\[nrt]/g, " ")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => ({ text: text.slice(0, 240), rating: "", date: "" }));

  return snippets;
}

function buildGlassdoorContext(reviews) {
  if (!reviews || reviews.length === 0) return "";
  const lines = reviews.map((r, i) => {
    const meta = [r.rating ? `${r.rating}/5` : "", r.date || ""].filter(Boolean).join(" · ");
    return `${i + 1}. ${meta ? `[${meta}] ` : ""}${r.text}`;
  });
  return `Latest public Glassdoor reviews for Workleap:\n${lines.join("\n")}`;
}

// Use Claude to pick the 2-3 most relevant Slack matches from rawMatches and
// generate a one-sentence suggestion for how to incorporate each in the reply.
// Returns an enriched array: { ...match, suggestion }.
async function rankAndSuggestSlackMatches(feedbackText, rawMatches) {
  if (!rawMatches || rawMatches.length === 0) return [];

  // Build a numbered list for Claude to reference by index
  const matchList = rawMatches
    .map((m, i) => `[${i}] #${m.channel} — ${m.author} (${m.date}): "${m.text}"`)
    .join("\n");

  const systemPrompt = `You help managers respond to anonymous employee feedback by surfacing the most relevant Slack discussions.

Given employee feedback and a list of Slack messages, select the 2-3 most relevant ones and for each write a short suggestion (≤20 words) on how the manager could reference or incorporate that thread in their reply.

Return ONLY valid JSON — no markdown, no explanation. Format:
[
  { "index": 0, "suggestion": "Reference the burnout discussion from #wellbeing to show this is a known pattern." },
  { "index": 2, "suggestion": "Link the #retro thread where the team agreed on workload limits last quarter." }
]`;

  const userContent = `Employee feedback:\n"${feedbackText}"\n\nSlack messages:\n${matchList}`;

  try {
    const raw = await callClaude(systemPrompt, userContent);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return rawMatches.slice(0, 2);

    const ranked = JSON.parse(jsonMatch[0]);
    return ranked
      .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < rawMatches.length)
      .slice(0, 3)
      .map((r) => ({ ...rawMatches[r.index], suggestion: r.suggestion || "" }));
  } catch (err) {
    console.error("[OV AI] rankAndSuggestSlackMatches:", err);
    return rawMatches.slice(0, 2);
  }
}

// Search Slack for messages semantically similar to the given feedback text.
// Returns an array of { author, text, date, channel, permalink, suggestion }.
async function handleSearchSlackSimilar({ feedbackText }) {
  const slackToken = await getSlackToken();
  if (!slackToken) {
    throw new Error("No Slack token configured. Add your Slack token in the extension popup.");
  }

  const query = extractKeywords(feedbackText);
  if (!query || query.trim().length < 4) {
    throw new Error("Could not extract enough keywords from feedback text.");
  }

  // xoxc- / xoxd- are Slack web-client session tokens that require POST
  // form-body auth.  Standard OAuth tokens (xoxp-, xoxb-) use GET + Bearer.
  const isSessionToken = slackToken.startsWith("xoxc-") || slackToken.startsWith("xoxd-");

  let response;

  if (isSessionToken) {
    // POST with URL-encoded form body — accepted by Slack's Web API for
    // session tokens.  credentials:"include" forwards the user's Slack "d"
    // cookie automatically (requires the user to be logged into Slack in
    // their Chrome browser session).
    const body = new URLSearchParams({
      token:     slackToken,
      query,
      count:     "5",
      highlight: "false",
      sort:      "score",
    });

    response = await fetch("https://slack.com/api/search.messages", {
      method:      "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } else {
    // Standard OAuth token — GET with Authorization: Bearer header.
    const url = new URL("https://slack.com/api/search.messages");
    url.searchParams.set("query",     query);
    url.searchParams.set("count",     "5");
    url.searchParams.set("highlight", "false");
    url.searchParams.set("sort",      "score");

    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${slackToken}`,
      },
    });
  }

  if (!response.ok) {
    throw new Error(`Slack API HTTP error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok) {
    // Map common Slack error codes to helpful, user-facing messages
    const errMap = {
      invalid_auth:   "Invalid Slack token — check the token in the popup.",
      not_authed:     "Missing Slack token — add your token in the popup.",
      token_revoked:  "Your Slack token has been revoked. Please regenerate it.",
      missing_scope:  "Slack token needs the 'search:read' scope.",
      ratelimited:    "Slack rate limit hit — please wait a moment.",
    };
    throw new Error(errMap[data.error] || `Slack error: ${data.error}`);
  }

  const rawMatches = (data.messages?.matches || []).slice(0, 5).map((m) => ({
    author:    m.username || m.user || "Unknown",
    text:      stripSlackMarkup(m.text).slice(0, 200),
    date:      formatSlackTs(m.ts),
    channel:   m.channel?.name || m.channel?.id || "unknown",
    permalink: m.permalink || "",
  }));

  if (rawMatches.length === 0) return [];

  // Pipe through Claude to select 2-3 most relevant + generate reply suggestions
  return await rankAndSuggestSlackMatches(feedbackText, rawMatches);
}

// Return latest public Workleap Glassdoor review snippets for panel display.
async function handleGetGlassdoorReviews() {
  const reviews = await fetchLatestGlassdoorReviews();
  return reviews.slice(0, 3);
}

// ─── Claude Handlers ──────────────────────────────────────────────────────────

// MBTI styles now live in config.js as CONFIG.MBTI_STYLES

// Generate a manager response suggestion for anonymous employee feedback
async function handleGenerateSuggestion({ feedbackText, context }) {
  const mbti = await getMbtiType();
  const mbtiInstruction = mbti && CONFIG.MBTI_STYLES[mbti]
    ? `\n\nThe manager's communication style (MBTI: ${mbti}): ${CONFIG.MBTI_STYLES[mbti]}. Adapt the reply to sound natural in this style — do not mention MBTI or personality type in the response.`
    : "";

  const systemPrompt = `You are an expert people manager and HR professional. You help managers craft thoughtful, empathetic, and constructive responses to anonymous employee feedback.

Your suggestions should:
- Acknowledge the feedback genuinely
- Be professional yet warm and human
- Show the manager is listening and taking it seriously
- Outline concrete next steps where appropriate
- Be concise (2-4 sentences for short feedback, up to a short paragraph for detailed feedback)
- Avoid being defensive or dismissive
- Preserve employee anonymity by not making assumptions about who sent it${mbtiInstruction}

Return ONLY the suggested response text, no preamble or explanation.`;

  const userContent = `Please suggest a manager response to this employee feedback:\n\n${feedbackText}${context ? `\n\nAdditional context: ${context}` : ""}`;

  return await callClaude(systemPrompt, userContent);
}

// Generate multiple reply options with different tones
async function handleGenerateReply({ feedbackText, tone }) {
  const toneInstructions = {
    empathetic:      "warm, empathetic, and emotionally supportive",
    action_oriented: "focused on action items and concrete next steps",
    appreciative:    "grateful and appreciative of the feedback",
    investigative:   "asking clarifying questions to better understand the issue",
    shorter:         "extremely concise and to the point — 1-2 short sentences maximum, no filler words",
  };

  const toneDescription = toneInstructions[tone] || toneInstructions.empathetic;

  const mbti = await getMbtiType();
  const mbtiInstruction = mbti && CONFIG.MBTI_STYLES[mbti]
    ? `\n- The manager's communication style (MBTI: ${mbti}): ${CONFIG.MBTI_STYLES[mbti]}. Adapt the reply to sound natural in this style — do not mention MBTI or personality type in the response.`
    : "";

  const systemPrompt = `You are an expert people manager. Generate a ${toneDescription} response to employee feedback.

Requirements:
- Keep it to 2-3 sentences
- Sound authentic, not corporate
- Be ${toneDescription}
- If external sentiment from Glassdoor is provided and relevant, briefly weave in a neutral acknowledgement of broader patterns${mbtiInstruction}
- Return ONLY the response text`;

  let glassdoorContext = "";
  const contextUsed = [];
  try {
    const reviews = await fetchLatestGlassdoorReviews();
    glassdoorContext = buildGlassdoorContext(reviews);
    if (glassdoorContext) {
      contextUsed.push("Glassdoor");
    }
  } catch (err) {
    console.error("[OV AI] Glassdoor fetch:", err);
  }

  const userContent = `Employee feedback: "${feedbackText}"${glassdoorContext ? `\n\n${glassdoorContext}\n\nUse Glassdoor context only if it clearly supports the response; do not force it.` : ""}`;
  const text = await callClaude(systemPrompt, userContent);
  return { text, contextUsed };
}

// Generate HR research insights relevant to the feedback topic
async function handleGetHrInsights({ feedbackText }) {
  const systemPrompt = `You are an HR research specialist. Given employee feedback, identify 2-3 relevant research findings or best practices from leading HR sources that would help a manager address this type of feedback effectively.

Sources to draw from (use whichever are most relevant):
- Gallup (Q12 engagement, manager-as-coach, strengths-based management, State of the Global Workplace reports)
- Harvard Business Review (psychological safety, feedback culture, employee engagement, leadership research)
- SHRM (Society for Human Resource Management — retention, workplace culture, HR best practices)
- Deloitte Human Capital Trends
- McKinsey Organizational Health
- Adam Grant, Brené Brown, Kim Scott (Radical Candor), or other recognized thought leaders

Return ONLY valid JSON — no markdown, no explanation. Format:
[
  {
    "source": "Gallup",
    "title": "Short title of the finding or framework (≤10 words)",
    "insight": "One-sentence practical insight the manager can apply (≤30 words)",
    "relevance": "Why this matters for this specific feedback (≤15 words)"
  }
]

Return 2-3 items maximum. Only include genuinely relevant findings — do not force a match.`;

  const raw = await callClaude(systemPrompt, `Employee feedback:\n"${feedbackText}"`);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const insights = JSON.parse(jsonMatch[0]);
  return insights.slice(0, 3);
}

// Summarize multiple feedback items into themes and insights
async function handleSummarizeFeedback({ feedbackItems }) {
  const systemPrompt = `You are an expert at analyzing employee feedback and identifying patterns.

Your task is to analyze a batch of employee feedback and provide:
1. Key themes (2-4 themes)
2. Sentiment overview (positive/negative/neutral breakdown)
3. Priority action items (top 2-3 things the manager should address)
4. Notable quotes (1-2 most impactful direct quotes)

Format your response as JSON with this structure:
{
  "themes": ["theme1", "theme2"],
  "sentiment": { "positive": 40, "negative": 35, "neutral": 25 },
  "actionItems": ["action1", "action2"],
  "notableQuotes": ["quote1", "quote2"],
  "summary": "One paragraph overview"
}`;

  const feedbackList = feedbackItems
    .map((item, i) => `${i + 1}. "${item}"`)
    .join("\n");

  const userContent = `Please analyze this batch of employee feedback:\n\n${feedbackList}`;

  const text = await callClaude(systemPrompt, userContent);

  // Parse JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return { summary: text };
}

// Analyze engagement metric score changes and suggest manager actions
async function handleAnalyzeEngagementMetrics({ metricTexts }) {
  const systemPrompt = `You are an expert people manager and organizational psychologist. You are given a list of employee engagement metric blocks scraped from an engagement survey platform. Each block contains a metric name, its current score, and an indicator of how it changed (up, down, or flat).

Your job:
1. Identify which metrics improved, declined, or stayed flat.
2. Write a single-sentence overall summary of the engagement trend.
3. Suggest the top 2 most important actions the manager should take — prioritize declining or low metrics. For each action assign a realistic deadline within the next 1–3 weeks from today (February 23, 2026).

Return ONLY valid JSON, no markdown, no explanation:
{
  "summary": "One sentence describing the overall engagement trend",
  "actions": [
    { "text": "Specific action the manager should take", "deadline": "March 2, 2026" }
  ]
}`;

  const userContent = `Engagement metric blocks:\n${metricTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

  const raw = await callClaude(systemPrompt, userContent);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { summary: raw, actions: [] };
  return JSON.parse(jsonMatch[0]);
}

// Search Slack for the last 2 days, identify accomplishments worth recognizing,
// and generate a "good vibe" recognition message for each.
async function handleFetchRecognitionSuggestions() {
  const slackToken = await getSlackToken();
  if (!slackToken) {
    throw new Error("No Slack token configured. Add your Slack token in the extension popup.");
  }

  // conversations.history accepts channel IDs directly — no name resolution needed.
  const oldest = String((Date.now() - 2 * 86_400_000) / 1000); // Unix seconds, 2 days ago
  const isSessionToken = slackToken.startsWith("xoxc-") || slackToken.startsWith("xoxd-");

  async function fetchChannelHistory(channelId) {
    let res;
    if (isSessionToken) {
      const body = new URLSearchParams({ token: slackToken, channel: channelId, oldest, limit: "20" });
      res = await fetch("https://slack.com/api/conversations.history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } else {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", channelId);
      url.searchParams.set("oldest", oldest);
      url.searchParams.set("limit", "20");
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { "Authorization": `Bearer ${slackToken}` },
      });
    }
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.ok) return []; // channel inaccessible — skip silently
    // Tag each message with its source channel ID for display
    return (data.messages || []).map((m) => ({ ...m, _channelId: channelId }));
  }

  // Helper: resolve a single Slack API call (POST for session tokens, GET for OAuth)
  async function slackGet(endpoint, params) {
    let res;
    if (isSessionToken) {
      const body = new URLSearchParams({ token: slackToken, ...params });
      res = await fetch(`https://slack.com/api/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } else {
      const url = new URL(`https://slack.com/api/${endpoint}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { "Authorization": `Bearer ${slackToken}` },
      });
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  }

  // Deduplicate channel list then fan out in parallel
  const uniqueChannels = [...new Set(CONFIG.RECOGNITION_CHANNELS)];
  const perChannelResults = await Promise.all(uniqueChannels.map(fetchChannelHistory));

  const seen = new Set();
  const merged = perChannelResults.flat().filter((m) => {
    if (seen.has(m.ts)) return false;
    seen.add(m.ts);
    return true;
  });

  if (!merged.length) return [];

  // Resolve user IDs → display names and channel IDs → channel names in parallel
  const uniqueUserIds    = [...new Set(merged.map((m) => m.user).filter(Boolean))];
  const uniqueChannelIds = [...new Set(merged.map((m) => m._channelId).filter(Boolean))];

  const [userResults, channelResults] = await Promise.all([
    Promise.all(uniqueUserIds.map((uid) =>
      slackGet("users.info", { user: uid }).catch((err) => { console.error("[OV AI] users.info:", err); return null; })
    )),
    Promise.all(uniqueChannelIds.map((cid) =>
      slackGet("conversations.info", { channel: cid }).catch((err) => { console.error("[OV AI] conversations.info:", err); return null; })
    )),
  ]);

  const userNames = {};
  uniqueUserIds.forEach((uid, i) => {
    const u = userResults[i]?.user;
    userNames[uid] = u?.profile?.display_name || u?.real_name || u?.name || uid;
  });

  const channelNames = {};
  uniqueChannelIds.forEach((cid, i) => {
    channelNames[cid] = channelResults[i]?.channel?.name || cid;
  });

  const rawMessages = merged.slice(0, 30).map((m) => ({
    author:  userNames[m.user] || m.username || m.user || "Unknown",
    text:    stripSlackMarkup(m.text).slice(0, 300),
    date:    formatSlackTs(m.ts),
    channel: channelNames[m._channelId] || m._channelId,
  }));

  if (!rawMessages.length) return [];

  const systemPrompt = `You are a team culture expert helping a manager celebrate wins and recognize their people.

Given recent Slack messages, identify up to 4 accomplishments, wins, or positive contributions genuinely worth recognizing. For each, write a short warm "good vibe" message the manager could send.

Return ONLY valid JSON, no markdown:
[
  {
    "who": "person's name or description from the message",
    "channel": "the channel name from the message list, prefixed with #",
    "achievement": "what they did in ≤12 words",
    "vibe": "warm 2-sentence recognition message, upbeat and genuine"
  }
]

Return [] if nothing recognition-worthy is found. Do not invent achievements not present in the messages.`;

  const messageList = rawMessages.map((m, i) => `[${i}] #${m.channel} — ${m.author} (${m.date}): "${m.text}"`).join("\n");
  const raw = await callClaude(systemPrompt, `Recent Slack messages (last 2 days):\n${messageList}`);

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  return JSON.parse(jsonMatch[0]).slice(0, 4);
}
