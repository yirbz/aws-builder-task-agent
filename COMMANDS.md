# Command Reference: AWS Builder Streak Agent 🚀

Complete documentation for all commands, scripts, CLI flags, and management tasks for the AWS Builder Streak Agent.

---

## 📑 Table of Contents

1. [Quick Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Docker Compose Commands (Recommended)](#docker-compose-commands-recommended)
   - [Interactive Web Authentication](#interactive-web-authentication)
   - [Executing Daily Streaks](#executing-daily-streaks)
   - [Watching Execution Live in Browser](#watching-execution-live-in-browser)
   - [Streak Status & Health Checks](#streak-status--health-checks)
   - [Interaction History Log](#interaction-history-log)
   - [24/7 Scheduler Daemon Management](#247-scheduler-daemon-management)
3. [Package Scripts (`pnpm` / `npm`)](#package-scripts-pnpm--npm)
4. [Native CLI Binary Reference (`streak-agent` / `node dist/index.js`)](#native-cli-binary-reference)
   - [`streak-agent run`](#streak-agent-run)
   - [`streak-agent status`](#streak-agent-status)
   - [`streak-agent auth:login`](#streak-agent-authlogin)
   - [`streak-agent history`](#streak-agent-history)
   - [`streak-agent scheduler:start`](#streak-agent-schedulerstart)
5. [Container Entrypoint Modes (`docker-entrypoint.sh`)](#container-entrypoint-modes-docker-entrypointsh)
6. [Testing & Build Commands](#testing--build-commands)
7. [Database & Troubleshooting Commands](#database--troubleshooting-commands)
8. [CLI Exit Codes Reference](#cli-exit-codes-reference)

---

## Quick Reference Cheat Sheet

| Task | `pnpm` Shortcut | `docker compose` Direct Command | Local CLI Command |
|---|---|---|---|
| **One-time Login (GUI)** | `pnpm run auth` | `docker compose run --rm --service-ports auth` | `node dist/index.js auth:login` |
| **Run Streak Today** | `pnpm run streak` | `docker compose run --rm streak-agent run` | `node dist/index.js run` |
| **Dry Run (Simulation)** | `pnpm run streak -- --dry-run` | `docker compose run --rm streak-agent run --dry-run` | `node dist/index.js run --dry-run` |
| **Force Immediate Run** | `pnpm run streak:force` | `docker compose run --rm streak-agent run --force --verbose` | `node dist/index.js run --force --verbose` |
| **Watch Run in Browser** | `pnpm run streak:watch` | `docker compose run --rm --service-ports streak-watch` | *(Requires X11/display)* |
| **Check Streak Health** | `pnpm run status` | `docker compose run --rm streak-agent status` | `node dist/index.js status` |
| **Status (JSON)** | `pnpm run status -- --json` | `docker compose run --rm streak-agent status --json` | `node dist/index.js status --json` |
| **View Past Interactions** | `pnpm run history` | `docker compose run --rm streak-agent history` | `node dist/index.js history` |
| **Start 24/7 Daemon** | `pnpm run scheduler:start` | `docker compose up -d streak-agent` | `node dist/index.js scheduler:start` |
| **View Daemon Logs** | `pnpm run scheduler:logs` | `docker compose logs -f streak-agent` | *(Check process stdout)* |
| **Stop 24/7 Daemon** | `pnpm run scheduler:stop` | `docker compose down` | `kill $(cat data/.scheduler.lock)` |
| **Run Unit Tests** | `pnpm run test:unit` | — | `vitest run tests/unit` |
| **Run All Tests** | `pnpm test` | — | `vitest run` |

---

## Docker Compose Commands (Recommended)

Docker is the primary environment for running the agent without host-specific browser, X11, or native driver dependencies.

### Interactive Web Authentication

Launches an isolated container with an Xvfb virtual desktop, fluxbox, x11vnc, and noVNC on port **6080**.

```bash
# Using pnpm shortcut (automatically detects and forwards Tailscale IP):
pnpm run auth

# Or directly with Docker Compose:
docker compose run --rm --service-ports auth
```

- **Remote Access (from your laptop via Tailscale)**:
  `http://<tailscale-ip>:6080/` or `http://yvniel-homelab:6080/`
- **Local Access (directly on host)**:
  `http://localhost:6080/`
- **SSH Port Forwarding Alternative**:
  `ssh -L 6080:localhost:6080 yvniel@<homelab-ip>` then open `http://localhost:6080/`
- **Usage**: Sign in to AWS Builder Center with your AWS Builder ID, solve MFA / CAPTCHA, and check "Remember this device".
- **Outcome**: Tokens and browser storage state are automatically saved to `./data/browser-profile/storage_state.json` upon successful login detection.

---

### Executing Daily Streaks

Run today's 5 streak steps (`authenticate` → `visit` → `like` → `comment` → `verify`):

#### Standard Run
```bash
docker compose run --rm streak-agent run
```

#### Simulation / Dry Run
Runs all steps without submitting likes or comments to AWS:
```bash
docker compose run --rm streak-agent run --dry-run
```

#### Force Run (Bypass Same-Day Check)
By default, the agent skips execution if today's streak was already recorded as completed in the database. Use `--force` to bypass this check:
```bash
docker compose run --rm streak-agent run --force
```

#### Force Run with Verbose Logging
```bash
docker compose run --rm streak-agent run --force --verbose
```

#### Single Step Execution
Target and run only a single specific step (`authenticate`, `visit`, `like`, `comment`, or `verify`):
```bash
# Test only the visit step
docker compose run --rm streak-agent run --step visit

# Test only the like step
docker compose run --rm streak-agent run --step like

# Test only comment generation and submission
docker compose run --rm streak-agent run --step comment

# Test verification against AWS badge progress API
docker compose run --rm streak-agent run --step verify
```

---

### Watching Execution Live in Browser

Streams the headful Chromium browser over noVNC on port **6080** while executing the streak run:

```bash
docker compose run --rm --service-ports streak-watch
```

- Open `http://localhost:6080/` to watch mouse movements, scrolling, humanized keystrokes, and badge progress live.

---

### Streak Status & Health Checks

Query streak progress, consecutive streak counts, remaining days to the 90-day goal, and the next run window:

#### Human-Readable Status Table
```bash
docker compose run --rm streak-agent status
```

#### JSON Output (For Automation / Monitoring Scripts)
```bash
docker compose run --rm streak-agent status --json
```

---

### Interaction History Log

Display recent likes and comments recorded in the SQLite database:

#### Default (Last 30 Days)
```bash
docker compose run --rm streak-agent history
```

#### Custom Days Range
```bash
docker compose run --rm streak-agent history --days 60
```

#### Filter by Action Type
```bash
# Show only likes
docker compose run --rm streak-agent history --action like

# Show only comments
docker compose run --rm streak-agent history --action comment
```

#### Machine-Readable JSON History
```bash
docker compose run --rm streak-agent history --days 7 --json
```

---

### 24/7 Scheduler Daemon Management

Runs the agent continuously as a background daemon. Each day within the configured schedule window (`windowStart` + jitter up to `windowMinutes`), it executes the streak tasks automatically.

#### Start the Background Daemon
```bash
docker compose up -d streak-agent
```

#### Follow Daemon Logs in Real Time
```bash
docker compose logs -f streak-agent
```

#### Check Daemon Container Status
```bash
docker compose ps
```

#### Restart the Daemon
```bash
docker compose restart streak-agent
```

#### Stop the Daemon
```bash
docker compose down
```

#### Rebuild Docker Image After Code Changes
```bash
docker compose build
# Or build with no cache:
docker compose build --no-cache
```

---

## Package Scripts (`pnpm` / `npm`)

Defined in `package.json`:

```json
"scripts": {
  "build": "tsc",
  "auth": "docker compose run --rm --service-ports auth",
  "auth:login": "docker compose run --rm --service-ports auth",
  "streak": "docker compose run --rm streak-agent run",
  "streak:force": "docker compose run --rm streak-agent run --force --verbose",
  "streak:watch": "docker compose run --rm --service-ports streak-watch",
  "status": "docker compose run --rm streak-agent status",
  "history": "docker compose run --rm streak-agent history",
  "scheduler:start": "docker compose up -d streak-agent",
  "scheduler:logs": "docker compose logs -f streak-agent",
  "scheduler:stop": "docker compose down",
  "install:browsers": "playwright install chromium",
  "local:auth": "node dist/index.js auth:login",
  "local:streak": "node dist/index.js run",
  "test": "vitest run",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration"
}
```

### Usage Examples with Arguments

When using `pnpm`, append extra CLI flags after `--`:

```bash
# Dry run via pnpm
pnpm run streak -- --dry-run

# Run single step via pnpm
pnpm run streak -- --step like

# Check status in JSON via pnpm
pnpm run status -- --json

# Query 90 days of history via pnpm
pnpm run history -- --days 90
```

---

## Native CLI Binary Reference

Entrypoint: `node dist/index.js <command> [options]` (or `streak-agent <command>` if linked via `npm link` / `pnpm link`).

### `streak-agent run`

Executes the daily streak tasks.

```bash
node dist/index.js run [options]
```

#### Available Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | `false` | Simulate execution without submitting likes or comments. |
| `--force` | boolean | `false` | Run even if today's run has already completed in the database. |
| `--step <name>` | string | *(none)* | Execute only a specific step: `authenticate`, `visit`, `like`, `comment`, `verify`. |
| `--verbose` | boolean | `false` | Output detailed execution logs to stdout. |
| `--config <path>` | string | `./config.json` | Path to custom configuration file. |

#### Examples
```bash
# Standard local run
node dist/index.js run

# Local dry run
node dist/index.js run --dry-run

# Force local execution with verbose output
node dist/index.js run --force --verbose

# Run only comment step with custom config
node dist/index.js run --step comment --config ./my-config.json
```

---

### `streak-agent status`

Queries current streak health and database records.

```bash
node dist/index.js status [options]
```

#### Available Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | `false` | Output status payload in JSON format. |
| `--config <path>` | string | `./config.json` | Path to custom configuration file. |

#### Output Example (Default Table)
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

### `streak-agent auth:login`

Launches interactive headed browser to authenticate with AWS Builder Center and save the session.

```bash
node dist/index.js auth:login [options]
```

#### Available Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--config <path>` | string | `./config.json` | Path to custom configuration file. |

---

### `streak-agent history`

Displays past interactions (likes, comments) recorded in SQLite.

```bash
node dist/index.js history [options]
```

#### Available Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--days <number>` | number | `30` | Number of past days to query. |
| `--action <type>` | string | *(all)* | Filter by action: `like` or `comment`. |
| `--json` | boolean | `false` | Output history in JSON format. |
| `--config <path>` | string | `./config.json` | Path to custom configuration file. |

#### Examples
```bash
node dist/index.js history --days 14
node dist/index.js history --action comment
node dist/index.js history --days 7 --action like --json
```

---

### `streak-agent scheduler:start`

Starts the continuous daily streak scheduler.

```bash
node dist/index.js scheduler:start [options]
```

#### Available Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--foreground` | boolean | `false` | Keep scheduler running in the foreground. |
| `--config <path>` | string | `./config.json` | Path to custom configuration file. |

*Note: Creates a process lock file at `data/.scheduler.lock` to prevent concurrent daemon instances.*

---

## Container Entrypoint Modes (`docker-entrypoint.sh`)

When invoking the Docker image directly with `docker run`:

```bash
docker run --rm -v $(pwd)/data:/app/data -v $(pwd)/config.json:/app/config.json:ro aws-builder-agent [mode] [args...]
```

The entrypoint script routes according to the first argument:

| Mode Argument | Action in Container |
|---|---|
| `auth` or `auth:login` | Starts Xvfb, fluxbox, x11vnc, noVNC on port 6080, and runs `node dist/index.js auth:login` |
| `streak:watch` or `run:watch` | Starts Xvfb, fluxbox, x11vnc, noVNC on port 6080, and runs `node dist/index.js run` with remaining arguments |
| `run` | Starts Xvfb display `:99` and executes `node dist/index.js run` with options |
| `scheduler:start` | Starts Xvfb display `:99` and executes `node dist/index.js scheduler:start` |
| *(Any other CLI command)* | Directly passes through to `node dist/index.js "$@"` (e.g. `status`, `history`) |

---

## Testing & Build Commands

### Compiling TypeScript

```bash
# Build dist/
pnpm run build

# Or using tsc directly
npx tsc

# Watch mode during development
npx tsc --watch
```

### Installing Playwright Browser (For Local Host Runs)

```bash
pnpm run install:browsers
# or:
npx playwright install chromium
```

### Running Test Suites (Vitest)

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm run test:unit

# Run integration tests only
pnpm run test:integration

# Run a specific test file
npx vitest run tests/unit/comment-generator.test.ts
npx vitest run tests/unit/config.test.ts
npx vitest run tests/unit/db.test.ts
npx vitest run tests/unit/notify.test.ts
npx vitest run tests/integration/streak-runner.test.ts

# Run tests in watch mode
npx vitest watch
```

---

## Database & Troubleshooting Commands

### Inspecting SQLite Database

The SQLite database file is located at `./data/streak-agent.db`.

```bash
# Query the latest 5 streak runs
sqlite3 data/streak-agent.db "SELECT run_id, started_at, completed_at, status, failure_reason FROM daily_runs ORDER BY started_at DESC LIMIT 5;"

# Query the latest 10 interactions (likes and comments)
sqlite3 data/streak-agent.db "SELECT id, action_type, post_id, post_title, created_at FROM interactions ORDER BY created_at DESC LIMIT 10;"

# Count total completed runs
sqlite3 data/streak-agent.db "SELECT status, COUNT(*) FROM daily_runs GROUP BY status;"

# Inspect structured observability events
sqlite3 data/streak-agent.db "SELECT event_type, step_name, timestamp FROM events ORDER BY timestamp DESC LIMIT 20;"
```

### Session and Lock Management

```bash
# Check saved authentication session
ls -la data/browser-profile/storage_state.json

# Clear saved session to force full re-login
rm -rf data/browser-profile/*

# Clear stale scheduler lock if previous process crashed
rm -f data/.scheduler.lock

# Inspect failure screenshots
ls -la data/screenshots/
```

---

## CLI Exit Codes Reference

| Exit Code | Classification | Meaning & Recommended Action |
|---|---|---|
| `0` | **Success** | All streak tasks completed successfully, or status is healthy. Streak is maintained. |
| `1` | **Partial / Warning** | Partial completion (one or more steps failed), streak at risk, or scheduler already running. Check logs or retry step. |
| `2` | **Fatal Error** | Critical unrecoverable error (uncaught exception, browser launch failure, DB permissions). |
| `3` | **Config Error** | Invalid or unparseable `config.json`. Check schema against `config.example.json`. |
| `4` | **Auth Expired** | Session tokens expired or invalid. Re-authenticate via `pnpm run auth`. |
