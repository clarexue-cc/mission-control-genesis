# Mission Control Local E2E Operating Contract

Date: 2026-04-29
Scope: local Mission Control validation on Clare's mac mini

This file is the shared operating contract for any agent asked to "open MC",
"continue MC testing", or run the P6-P22 customer setup checks.

## Non-negotiable default

When Clare says "open MC", open the current customer setup test build, not a stale
checkout, not the parent harness directory, and not a random dashboard instance.

Canonical local worktree:

```bash
/Users/clare/Desktop/.worktrees/mission-control-fix-p5-approval-v2
```

Canonical dev server:

```bash
cd /Users/clare/Desktop/.worktrees/mission-control-fix-p5-approval-v2
MC_HARNESS_ROOT=/Users/clare/Desktop/genesis-harness \
PORT=3300 \
corepack pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3300
```

Canonical browser URL:

```text
http://127.0.0.1:3300/
```

Expected default behavior:

- `/` redirects to the latest Customer Setup page.
- Current latest page is P4 customer blueprint generation:
  `/onboarding/customer/analyze?tenant=ceo-assistant-v1`.
- The main Mission Control dashboard is `/overview`.
- Do not use `/` as a dashboard return target during customer setup testing.

## Required preflight before touching the browser

Run these checks before using Computer Use or browser automation:

```bash
pwd
git remote -v
git branch --show-current
lsof -nP -iTCP:3300 -sTCP:LISTEN
```

The repo must be `clarexue-cc/mission-control-genesis`. The working directory
must be the canonical worktree above unless Clare explicitly names another one.

If port 3300 is served by the wrong process or a stale worktree, stop and fix the
server first. Do not continue testing against the wrong build.

## Login contract

Dev / preview E2E login is fixed to one account:

```text
username: clare-admin
password: dev-test-123
```

Do not guess other accounts. The old `admin`, `testadmin`, and
`admin@genesis.local` identities are not the Mission Control dev/preview login.
`admin@genesis.local` belongs to Langfuse or other tracing backends and must not
be reused for MC.

If login fails, inspect the local test database first:

```bash
cd /Users/clare/Desktop/.worktrees/mission-control-fix-p5-approval-v2
node -e "const Database=require('better-sqlite3'); const db=new Database('.data/mission-control.db'); console.log(db.prepare('select id, username, role, provider, is_approved from users').all())"
```

For this local E2E database only, if the `clare-admin` password hash has drifted,
realign it to the test password instead of guessing:

```bash
node - <<'NODE'
const Database = require('better-sqlite3')
const { hashPassword } = require('./src/lib/password.ts')
const db = new Database('.data/mission-control.db')
db.prepare('update users set password_hash = ?, updated_at = ? where username = ?')
  .run(hashPassword('dev-test-123'), Math.floor(Date.now() / 1000), 'clare-admin')
console.log('clare-admin test password reset for local E2E')
NODE
```

Never save the test password in Chrome.

## Customer setup checkpoints

Current P6-P22 test target tenant:

```text
ceo-assistant-v1
```

During dev / preview validation, pages without an explicit `?tenant=` must
resolve to `ceo-assistant-v1`. URL overrides are still allowed for targeted
multi-tenant checks.

Stop for Clare confirmation at every checkpoint. Capture evidence before moving
to the next P node.

Checkpoint URLs:

- P6: `/onboarding/customer/deploy?role=admin&tenant=ceo-assistant-v1`
- P7: `/onboarding/customer/soul?role=admin&tenant=ceo-assistant-v1`
- P8: `/boundary?tenant=ceo-assistant-v1`
- P9: `/onboarding/customer/skills?tenant=ceo-assistant-v1`
- P10: `/tests?tenant=ceo-assistant-v1`
- P11: `/logs?tenant=ceo-assistant-v1`
- P12: `/vault?tenant=ceo-assistant-v1`
- P13: cross-session recall through Test Console plus vault evidence
- P14: `/hermes?tenant=ceo-assistant-v1`
- P15: Hermes stuck-alert simulation plus Alerts evidence
- P16: Cost Tracker plus Exec Approvals evidence
- P17: Alerts aggregation plus Activity Feed evidence
- P18: Delivery checklist / RTS 10 checks
- P19: customer role view with `?role=customer`
- P20: customer Channels view
- P21: customer UAT tasks and feedback persistence
- P22: Delivery Export PDF

## Evidence contract

For each checkpoint:

1. Capture the visible screen or page-level screenshot.
2. Write a short evidence summary.
3. Upload the evidence to GitHub so other reviewers can see it.
4. Stop and wait for Clare confirmation before proceeding.

Prefer repository evidence files when binary screenshots are needed because
`gh gist create` does not accept PNG binaries directly.

Recommended path pattern:

```text
evidence/p<N>-<short-name>/p<N>-<short-name>-YYYYMMDD.png
evidence/p<N>-<short-name>/summary-YYYYMMDD.md
```

If using a temporary evidence branch, name it clearly:

```text
codex/p<N>-e2e-evidence-YYYYMMDD
```

## Language and wording

Do not call the current customer validation a "dry run".

Use:

```text
正式连续 E2E 实机跑测
```

Any remaining UI or evidence text that says "dry run" is a visible defect and
must be recorded instead of ignored.

## Stop conditions

Stop immediately and report the exact screen, URL, console/server log, and
terminal context when any of these happen:

- `/` does not open the Customer Setup latest page.
- The browser is pointed at a stale MC checkout or wrong port.
- Login fails after the database check/reset path above.
- A checkpoint is missing required customer data.
- A customer-facing page exposes internal-only panels in customer role.
- A screenshot would leak unrelated browser tabs, bookmarks, or personal data.

The goal is not just to get through the checklist. The goal is repeatable,
auditable MC testing with one shared source of truth.
