# AWS Builder Streak Agent 🚀

[![Docker](https://img.shields.io/badge/Docker-First-2496ED.svg?logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.0.0-orange.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An autonomous, stealth interaction agent designed to maintain daily streaks on **AWS Builder Center** (`builder.aws.com`) for 90 consecutive days without triggering anti-bot detection.

Specifically targets:
1. 🌐 **"Visit Builder Center daily for 90 consecutive days"**
2. 👍 **"Like content daily for 90 consecutive days"**
3. 💬 **"Comment daily for 90 consecutive days"**

---

## 🐳 Containerized-First Design

This application is built **Docker-first** to guarantee long-term stability and eliminate host dependency headaches (missing browser binaries, OS-specific C++ toolchains, Python/CDP conflicts, or display server issues). 

The entire browser automation stack—including **Chromium**, **Xvfb virtual display**, **`better-sqlite3` native drivers**, and an **in-browser HTML5 noVNC remote interface**—is encapsulated within Docker.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           DOCKER CONTAINER ENVIRONMENT                         │
│                                                                                │
│  ┌──────────────────────┐   ┌───────────────────────┐   ┌───────────────────┐  │
│  │     Xvfb Display     │   │   x11vnc + noVNC      │   │  Pre-installed    │  │
│  │  (1920x1080 24-bit)  │   │  (Port 6080 Web GUI)  │   │  Chromium Engine  │  │
│  └──────────┬───────────┘   └───────────┬───────────┘   └─────────┬─────────┘  │
│             └───────────────────────────┼─────────────────────────┘            │
│                                         ▼                                      │
│                         ┌───────────────────────────────┐                      │
│                         │   Stealth Automation Agent    │                      │
│                         │     (rebrowser-playwright)    │                      │
│                         └───────────────┬───────────────┘                      │
└─────────────────────────────────────────┼──────────────────────────────────────┘
                                          │ Persistent Mounts
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
            ./data/browser-profile/                   ./data/streak-agent.db
        (Session tokens & cookies)                (SQLite runs & interactions)
```

---

## 🚀 Quick Start (Containerized-First)

### 1. Clone & Configure

```bash
git clone https://github.com/your-username/aws-builder-agent.git
cd aws-builder-agent

# Create your configuration from example
cp config.example.json config.json
```

Edit `config.json` with your desired run window and notifications:

```json
{
  "schedule": {
    "windowStart": "10:45",
    "windowMinutes": 45,
    "timezone": "America/New_York"
  },
  "comments": {
    "provider": "gemini",
    "geminiApiKey": "YOUR_GEMINI_API_KEY"
  },
  "notifications": {
    "telegram": {
      "enabled": false,
      "botToken": "",
      "chatId": ""
    }
  }
}
```

---

### 2. One-Time Interactive Authentication (via Web Browser)

Because AWS Builder ID login requires solving adaptive WAF CAPTCHAs and MFA, the container provides an **in-browser visual interface via noVNC**:

```bash
# Using pnpm shortcut:
pnpm run auth

# Or directly with Docker Compose:
docker compose run --rm --service-ports auth
```

1. The console will display:
   ```text
   ========================================================================
   🌐 INTERACTIVE BROWSER READY FOR AWS BUILDER CENTER LOGIN!
   👉 Open in your web browser: http://localhost:6080/
   ========================================================================
   ```
2. Open **`http://localhost:6080/`** in your host browser (Chrome, Firefox, Safari, Edge).
3. You will see a live remote desktop showing Chromium loaded at `builder.aws.com`.
4. Sign in with your **AWS Builder ID**, complete MFA / CAPTCHA, and check **"Remember this device / Trust this device"**.
5. The agent monitors authentication status passively without page refreshes. Once your session is confirmed via the Builder Center API and profile menu, it exports session cookies to `./data/browser-profile/storage_state.json` and shuts down cleanly.

---

### 3. Verify with Dry Run

Simulate a full 5-step daily run inside Docker without making live changes:

```bash
# Using pnpm shortcut:
pnpm run streak -- --dry-run

# Or directly with Docker Compose:
docker compose run --rm streak-agent run --dry-run
```

---

### 4. Check Streak Status

Query your current streak progress, next window, and health metrics:

```bash
# Using pnpm shortcut:
pnpm run status

# Or directly with Docker Compose:
docker compose run --rm streak-agent status
```

Output:
```text
AWS Badge Streak Agent — Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Streak          Days    Target    Status
  ──────          ────    ──────    ──────
  Visit           1/90   90        ✅ Today completed
  Like            1/90   90        ✅ Today completed
  Comment         1/90   90        ✅ Today completed

  Last run:       2026-09-11T04:26:31.965Z (completed)
  Next window:    10:45 (America/New_York, window: 45m)
  Days remaining: 89
```

---

### 5. Launch the 24/7 Daily Streak Daemon

Start the containerized background scheduler that wakes up daily with pseudo-random jitter:

```bash
# Using pnpm shortcut:
pnpm run scheduler:start

# Or directly with Docker Compose:
docker compose up -d streak-agent
```

View live logs and execution traces:
```bash
pnpm run scheduler:logs
# or: docker compose logs -f streak-agent
```

To stop the scheduler:
```bash
pnpm run scheduler:stop
# or: docker compose down
```

---

## 💻 Command Reference

All commands are mapped in `package.json` for convenience and can also be executed directly with `docker compose`:

| Action | `pnpm` Shortcut | `docker compose` Native Command | Description |
|---|---|---|---|
| **Interactive Login** | `pnpm run auth` | `docker compose run --rm --service-ports auth` | Launches noVNC browser on port 6080 for one-time login |
| **Daily Run (Live)** | `pnpm run streak` | `docker compose run --rm streak-agent run` | Executes today's 5 streak steps |
| **Trigger Run Now** | `pnpm run streak:force` | `docker compose run --rm streak-agent run --force --verbose` | Forces immediate live execution with full logs |
| **Watch Run Live** | `pnpm run streak:watch` | `docker compose run --rm --service-ports streak-watch` | Forces live execution while letting you watch in browser at :6080 |
| **Dry Run** | `pnpm run streak -- --dry-run` | `docker compose run --rm streak-agent run --dry-run` | Simulates steps without mutating platform |
| **Force Run** | `pnpm run streak -- --force` | `docker compose run --rm streak-agent run --force` | Bypasses same-day idempotency check |
| **Check Status** | `pnpm run status` | `docker compose run --rm streak-agent status` | Shows streak counts, next window, and health |
| **Status (JSON)** | `pnpm run status -- --json` | `docker compose run --rm streak-agent status --json` | Machine-readable health payload |
| **View History** | `pnpm run history` | `docker compose run --rm streak-agent history` | Displays recent likes and comments log |
| **Start Daemon** | `pnpm run scheduler:start` | `docker compose up -d streak-agent` | Runs 24/7 background scheduler daemon |
| **View Daemon Logs** | `pnpm run scheduler:logs` | `docker compose logs -f streak-agent` | Follows real-time scheduler output |
| **Stop Daemon** | `pnpm run scheduler:stop` | `docker compose down` | Stops background scheduler container |

---

## 🛠️ Alternative: Local Host Execution (Non-Docker)

If you prefer to run directly on your host machine without Docker:

### 1. Install Dependencies & Native Addons

```bash
pnpm install
```

> [!NOTE]
> `pnpm-workspace.yaml` is pre-configured with `allowBuilds: { better-sqlite3: true, esbuild: true }` so native binaries compile automatically.

### 2. Install Playwright Chromium

```bash
pnpm run install:browsers
# or: pnpm exec playwright install chromium
```

### 3. Build & Run Locally

```bash
pnpm run build
pnpm run local:auth
pnpm run local:streak -- --dry-run
pnpm run status
```

---

## ⚙️ Configuration Reference

### Options (`config.json`)

```json
{
  "schedule": {
    "windowStart": "10:45",
    "windowMinutes": 45,
    "timezone": "America/New_York"
  },
  "browser": {
    "profileDir": "./data/browser-profile",
    "screenshotOnFailure": true
  },
  "comments": {
    "provider": "gemini",
    "geminiApiKey": "AIzaSy...",
    "geminiModel": "gemini-2.0-flash",
    "ollamaBaseUrl": "http://localhost:11434",
    "ollamaModel": "llama3.2:3b",
    "timeoutMs": 8000
  },
  "notifications": {
    "telegram": {
      "enabled": false,
      "botToken": "",
      "chatId": ""
    },
    "discord": {
      "enabled": false,
      "webhookUrl": ""
    }
  },
  "database": {
    "path": "./data/streak-agent.db"
  },
  "retry": {
    "maxAttempts": 3,
    "baseDelayMs": 2000,
    "maxDelayMs": 30000
  }
}
```

### Environment Variable Overrides

Any setting in `config.json` can be overridden via environment variables prefixed with `STREAK_` and double underscores (`__`) for nested keys:

| Variable | Target Config Key | Example |
|---|---|---|
| `STREAK_SCHEDULE__WINDOW_START` | `schedule.windowStart` | `14:30` |
| `STREAK_SCHEDULE__WINDOW_MINUTES` | `schedule.windowMinutes` | `60` |
| `STREAK_SCHEDULE__TIMEZONE` | `schedule.timezone` | `America/New_York` |
| `STREAK_COMMENTS__GEMINI_API_KEY` | `comments.geminiApiKey` | `AIza...` |
| `STREAK_NOTIFICATIONS__TELEGRAM__ENABLED` | `notifications.telegram.enabled` | `true` |
| `STREAK_NOTIFICATIONS__TELEGRAM__BOT_TOKEN` | `notifications.telegram.botToken` | `123:ABC` |
| `STREAK_NOTIFICATIONS__TELEGRAM__CHAT_ID` | `notifications.telegram.chatId` | `12345` |
| `STREAK_NOTIFICATIONS__DISCORD__ENABLED` | `notifications.discord.enabled` | `true` |
| `STREAK_NOTIFICATIONS__DISCORD__WEBHOOK_URL` | `notifications.discord.webhookUrl` | `https://discord.com/...` |
| `STREAK_DATABASE__PATH` | `database.path` | `./data/streak-agent.db` |

---

## 🤖 3-Tier AI Comment Engine

The agent generates unique, contextual 1–2 sentence peer-developer comments using a resilient 3-tier cascade:

```
[Article Context] → 1. Google Gemini 2.0 Flash (Free Tier: 1500 calls/day)
                         ↓ (on timeout or rate-limit)
                    2. Local Ollama (llama3.2:3b)
                         ↓ (if Ollama offline)
                    3. Dynamic Template Fallback (>110 combinations)
                         ↓
                    [Deduplication Check against SQLite]
                         ↓
                    [Submit via Human-Paced Typing]
```

- **Perspective-Injected Prompts**: Randomizes developer viewpoints (`Gotcha`, `Alternative Pattern`, `Cost/Ops`, `Nuance`) at `temperature: 0.75`.
- **Negative Constraints**: Strictly prohibits bot phrases like *"Great article"*, *"Thanks for sharing"*, *"In this post"*.
- **Length Constraint**: Enforces 1–2 sentences (under 40 words) in an authentic peer-developer tone.

---

## 🔔 Webhook Notifications (Telegram & Discord)

Notifications are pushed upon daily completion or critical failure.

- **Telegram**: Formatted with HTML mode (`parse_mode: 'HTML'`) and attaches full-page viewport screenshots on failure via `POST /sendPhoto`.
  - Create a bot via [`@BotFather`](https://t.me/botfather).
  - Find your chat ID via [`@userinfobot`](https://t.me/userinfobot).
- **Discord**: Color-coded rich embed (Green for success, Amber for partial, Red for failure) with attached screenshot via `multipart/form-data`.
  - Create a webhook in **Channel Settings** → **Integrations** → **Webhooks**.

---

## 🛡️ Troubleshooting & Exit Codes

### CLI Exit Codes

| Code | Meaning | Action |
|---|---|---|
| `0` | Daily tasks completed successfully | Streak maintained. |
| `1` | Partial completion | Review logs; retry failed step. |
| `2` | Fatal execution error | Check network, database permissions, or display. |
| `3` | Configuration validation failure | Verify `config.json` against required schema. |
| `4` | Authentication session expired | Run `pnpm run auth` to re-authenticate. |

### Common FAQs

- **"Executable doesn't exist at ~/.cache/ms-playwright/chromium..."**:
  You are attempting to run outside Docker on the host machine without having Playwright Chromium installed. Run the standard containerized command instead:
  ```bash
  pnpm run auth
  ```
  Or install Chromium on your host machine to run locally:
  ```bash
  pnpm run install:browsers
  pnpm run local:auth
  ```
- **"Authentication session expired (Exit Code 4)"**:
  Tokens expire after 24–48 hours if unrefreshed. Running daily automatically keeps sessions alive. If the agent was offline for multiple days, simply rerun `pnpm run auth`.
- **"Page keeps refreshing during login"**:
  Resolved in v1.0.0. The interactive login loop passively monitors authentication indicators (DOM avatar, the `/rms/badges/progress` endpoint, and Cognito tokens) without issuing navigations or wiping your entered credentials.
- **"No unliked articles available" / Low-content alert**:
  Fires when fewer than 10 un-interacted articles remain in the feed. Check Builder Center to explore new categories or publish content.

---

## 🧪 Testing

Unit and integration test suites run via Vitest:

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm run test:unit

# Run integration tests only
pnpm run test:integration
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
