# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ReviewPing is a Chrome Extension (Manifest V3) that enables one-click Slack notifications for GitHub PR review workflows. It injects a floating button on GitHub PR pages to send review request/completion messages to Slack.

## Development Commands

This is a vanilla JavaScript Chrome extension with no build system, package manager, or test framework.

**Installation for development:**
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select the `review-ping` directory

**Reloading after changes:**
- Click the refresh icon on the extension card in `chrome://extensions/`
- For content script changes, also refresh the GitHub PR page

## Architecture

```
Chrome Extension (Manifest V3)
├── background/background.js  - Service Worker: Slack API calls, message templating
├── content/content.js        - Content Script: Injects floating button on GitHub PR pages
├── content/content.css       - Button styling (mostly inline styles used for reliability)
├── popup/                    - Extension popup (quick status display)
├── options/                  - Settings page (Slack config, user mappings, repo whitelist)
└── manifest.json             - Extension configuration
```

**Data flow:**
1. Content script detects PR page (`/github.com/.+/.+/pull/\d+/`)
2. Extracts PR info via DOM selectors (title, author, reviewers)
3. Shows green "리뷰 요청" button for PR author, purple "리뷰 완료" for reviewers
4. On click, sends `chrome.runtime.sendMessage()` to service worker
5. Service worker posts to Slack API with templated message

**Key patterns:**
- Multiple fallback DOM selectors for GitHub elements (GitHub changes DOM frequently)
- `MutationObserver` handles GitHub SPA navigation
- `chrome.storage.sync` for cross-device settings with `localStorage` backup
- AES-GCM encryption for settings export/import

## Storage Schema

```javascript
chrome.storage.sync: {
  connectionType: 'bot' | 'webhook',  // Connection method
  botToken: string,           // Slack bot token (xoxb-*) - for bot mode
  channelId: string,          // Default Slack channel ID (C*) - for bot mode
  webhookUrl: string,         // Default Slack Incoming Webhook URL - for webhook mode
  channelMappings: [{         // Per-repo channel routing (optional)
    repo: string,             // "owner/repo" or "owner/*"
    channelId?: string,       // Channel ID for bot mode
    webhookUrl?: string       // Webhook URL for webhook mode
  }],
  requestTemplate: string,    // Message template for review requests
  completeTemplate: string,   // Message template for completions
  userMappings: [{github, slack}], // GitHub→Slack username mapping
  allowedRepos: string[]      // Repository whitelist (e.g., "owner/*", "owner/repo")
}
```

## Template Variables

Available in message templates:
- `{pr_title}`, `{pr_url}`, `{pr_number}`, `{repo}`
- `{author}` - PR author (with Slack mention if mapped)
- `{reviewers}` - All reviewers (for request messages)
- `{reviewer}` - Current user (for completion messages)

## Notes

- UI and comments are in Korean
- Extension auto-opens options page on first install
- Empty `allowedRepos` means all repositories are allowed
