# Officevibe AI Assistant Chrome Extension

## Project Overview
Chrome extension (MV3) that injects AI suggestions into officevibe.workleap.com.

## File Structure
- `manifest.json` — MV3 manifest, host permissions for officevibe.workleap.com
- `background.js` — Service worker, calls Claude API (claude-sonnet-4-6)
- `content.js` — Content script: DOM detection, button injection, sidebar
- `popup.html` / `popup.js` — Settings UI for Anthropic API key
- `styles.css` — All injected UI styles (CSS custom properties prefixed with --ov-ai-)
- `icons/` — Generated PNGs (16, 48, 128px)
- `generate-icons.js` — Node canvas script to regenerate icons

## Architecture Notes
- CSS class prefix: `ov-ai-assistant-` (avoids collisions with Officevibe's classes)
- Content script uses MutationObserver to handle SPA navigation
- FEEDBACK_SELECTORS array in content.js controls which elements get AI buttons — needs tuning after login to see real DOM
- Background handles 3 message types: GENERATE_SUGGESTION, GENERATE_REPLY, SUMMARIZE_FEEDBACK
- API key stored in chrome.storage.sync

## Folder Name
Project folder is `ov-ce-workshop` on the Desktop (was previously `chrome-extension`).

## Key Next Step
After loading the extension, log into Officevibe and inspect the feedback page DOM to tune FEEDBACK_SELECTORS in content.js to match actual element classes.


# Raw Prompt Notes

- build a chrome extension that will be parsing officevibe.workleap.com after logged in

## Insights Box

- add insights box to the landing page:  https://officevibe.workleap.com/portal/home, for class class="card empty-checklist-card". The insights should take the changes in my engagement scores, located under /portal/team-insights "Metrics that fluctuated the most" -> class "metric-variation-block__label", copy the innerHTML and add it to the insights box
- the insights box should be place fully inside the "card empty-checklist-card" TODO WHEN IT"S NOT EMPTY, which class?

- below the metrics that fluctuated the most, use the value and based on that suggest actions to take to improve by using AI

- for the home page insights box, also include info on the last 2 feedback entries from  https://officevibe.workleap.com/portal/feedback/survey and their corresponding dates, include how much time elasped and if these feedbacks have been read or not
- if there are no unseen (not-seen) cards, just mention it in the insights box

- Include the last 2 feedback replies (unread) taken from https://officevibe.workleap.com/portal/feedback/survey/teams, (left side) class="ov-scrollviewer conversation-summary-list-container"


## Left Side 

- in the home-page-take-survey box, below the take survey button, put a small info saying the last time the user has responded to the survey, you can use a fixed date Feb 10, 2026 and show many days has gone by since
- under "class="contextual-link call-to-action-link" that goes to recognition, go through slack and identify the last 2 days worth of messages, accomplishment that are worth to recognize and provide a good vibe to
- as for the recommended recognitions, show what channels you looked for to highlight what to recognize, there have been some good ones


## Feedback Reply
- in addition to "related to slack threads", include Gallup/HBR or any other HR industry leading sources on how to address brought up feedback
    - no, don't include gallup etc wording and sources in the reply, use it below in recommended (similar to related slack threads) below the reply
- through the config setting of the extension, also ask the user what MBIT they are so the reply can be better adjusted to the manager who is giving the reply
- allow also a "shorter" option as a reply. No MBTI Styles popup came up


## Enhancements
- move all fixed variables into a config file from the background.js, for the recognition slack parsing, create channels that you define that should be looked at
- for the "RECOGNITION_CHANNELS" - I included the channel IDs as value and not their names, please use that to scan trhough slack with the slack MCP
- any errors of the chrome extension, make it output to the chrome console


## Changes / Issues 
- why is there no result? "Recognition ideas · last 2 days in Slack"
- show the username and not user ID, as well as channel name and not channel ID in the frontend under the good vibes box
-  now it only show "undefined" in the class="ov-ai-assistant-insights-box-list" intead of the metrics from the team-insights page

- change the position of the "AI suggest" button and add it next to the "share" button on the right side
- add insights box to the landing page:

  https://officevibe.workleap.com/portal/home, for class class="card empty-checklist-card". The insights should take the changes in my engagement scores, located under /portal/team-insights -> class "metric-variation-block__label", copy the innerHTML and add it to the box of card empty-checklist card
- instead of using what's listed in the METRIC_LABEL_SEL variable, show the blocks in metric-variation-block__content on the team-insights page
- don't put ov-ai-assistant-insights box below card-content empty-checklist-car_content but replace it or put it inside

- now it only show "undefined" in the class="ov-ai-assistant-insights-box-list" intead of the metrics from the team-insights page



