# Setup Guide

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and configured
- Node.js 18+ (for PDF generation and utility scripts)
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start (5 steps)

### 1. Clone and install

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops
npm install
npx playwright install chromium   # Required for PDF generation
```

### 2. Configure your profile

```bash
cp config/profile.example.yml config/profile.yml
```

Edit `config/profile.yml` with your personal details: name, email, target roles, narrative, proof points.

### 3. Add your CV

Create `cv.md` in the project root with your full CV in markdown format. This is the source of truth for all evaluations and PDFs.

(Optional) Create `article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals.example.yml portals.yml
```

Edit `portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Add companies you want to track in `tracked_companies`
- Customize `search_queries` for your preferred job boards

### 5. Start using

Open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. Career-ops will automatically evaluate it, generate a report, create a tailored PDF, and track it.

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-ops scan` |
| Process pending URLs | `/career-ops pipeline` |
| Generate a PDF | `/career-ops pdf` |
| Batch evaluate | `/career-ops batch` |
| Check tracker status | `/career-ops tracker` |
| Fill application form | `/career-ops apply` |

## Verify Setup

```bash
node cv-sync-check.mjs      # Check configuration
node verify-pipeline.mjs     # Check pipeline integrity
```

## Scheduled local discovery (Linux/systemd)

Scheduled discovery is local to the Linux user. It writes only operational
metadata under `data/autodiscovery/`; it does not run evaluation or generate
application materials. Before scheduling, complete and validate the Target
Profile and prove a manual collector run works with your approved collector
adapter. Do not schedule Interceptor until its separate `Jobbie Discovery`
browser profile and exact source allowlist are working.

1. Set `discovery.enabled: true` and `discovery.schedule: daily` or `weekdays`
   in `config/target-profile.yml`.
2. Keep the collector adapter inside this repository. The adapter must export
   only `{ collectors }` and must not contain credentials in its path or unit
   configuration.
3. Install the user timer; this uses the current absolute Node executable and
   requires neither `sudo` nor a system-wide unit:

```bash
npm run scheduler:systemd -- install --collector-adapter agent/collectors/approved-adapter.mjs
```

The default window is 09:00 local time every day or Monday–Friday, based on
the saved profile. systemd adds up to five minutes of jitter. Choose a
different local window with `--on-calendar "Mon..Fri *-*-* 08:30:00"`.

```bash
npm run scheduler:systemd -- status
npm run scheduler:status
```

The installed unit has an explicit Node path, repository working directory,
and `data/autodiscovery/` read-write path. It uses a restrictive umask and
contains no secrets, cookies, browser profile paths, or collector output.

### Login, shutdown, and recovery

`systemd --user` timers normally run while you are logged in. `loginctl
enable-linger "$USER"` can keep a user manager running after logout, but it
may require host-administrator approval; Career Ops does not run it or ask for
root. Enable lingering only on a private VM where that background behavior is
intended.

Before shutting down the VM, disable the timer or turn on the local kill
switch. A stopped VM does not queue missed discovery runs (`Persistent=false`).
After restart, confirm the browser context is available, inspect status, then
re-enable only when manual collection remains healthy:

```bash
npm run scheduler:status -- --kill-switch on
npm run scheduler:systemd -- uninstall
# After recovery and a successful manual check:
npm run scheduler:systemd -- install --collector-adapter agent/collectors/approved-adapter.mjs
npm run scheduler:status -- --kill-switch off
```

## Build Dashboard (Optional)

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..  # Opens TUI pipeline viewer
```
