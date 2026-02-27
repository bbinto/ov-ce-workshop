# Pre-Requisities


## Slack
As part of the Chrome extension, you will want to gather info on specific people or channels in Slack to help you write a recommended Goovibe or add additional info

This is NOT required to build an extension but will make your OV extension so much better.


### Open Slack on web

- Make sure to open Chrome and have the Slack web app running, authenticate with Auth code etc. workleap.slack.com

## GET API Token
- You will need to setup your Slack integrations
```
SLACK_XOXC_TOKEN: "xoxc-YOUR-TOKEN-HERE",
SLACK_XOXD_TOKEN: "xoxd-YOUR-TOKEN-HERE",
```

### Lookup SLACK_MCP_XOXC_TOKEN
Open your browser's Developer Console.
- In Firefox, under Tools -> Browser Tools -> Web Developer tools in the menu bar
- In Chrome, click the "three dots" button to the right of the URL Bar, then select More Tools -> Developer Tools

- Switch to the console tab.
- Type "allow pasting" and press ENTER.
- Paste the following snippet and press ENTER to execute: 
```
JSON.parse(localStorage.localConfig_v2).teams[document.location.pathname.match(/^\/client\/([A-Z0-9]+)/)[1]].token
```
Token value is printed right after the executed command (it starts with xoxc-), save it somewhere for now.

### Lookup SLACK_MCP_XOXD_TOKEN
- Switch to "Application" tab and select "Cookies" in the left navigation pane.
- Find the cookie with the name d. That's right, just the letter d.
- Double-click the Value of this cookie.
- Press Ctrl+C or Cmd+C to copy it's value to clipboard.

### Setup Code Agent

- If you a have Claude Code license from Workleap and installed the Desktop app - you are GOOD, just make sure that your Claude Code tab works, e.g. write "Create a simple Hello World script" and see if it returns something

- No Claude code liences/app installed
- - Use private instance and install Claude Desktop
- - Use Codex with your ChatGPT Workleap license


### Use (Barbara's) Claude API Key
- No need to create an API key - I will provide this. This API key will be used to let AI do magic on top of your OV chrome extension, e.g. suggesting Goodives, creating action items. This is different from using AI to *build* your Chrome extension code.

### Access OV in Chrome

- Make sure you have access to an officevibe instance, can be your own (if you are a manager) or an IC using Globex or OV3.