# Latest Release Failure Investigation

## Goal And Scope
Identify the most recent failed release from actual publisher records and explain its failure with timestamp, step and evidence. Read-only diagnosis; no release retry, Docker startup, production change or source fix. Do not assume the latest failure matches earlier Docker incidents.

## Method And Acceptance
Read bounded structured summaries from persisted history and current console if necessary. Select newest failure by recorded timestamps, inspect its failed step and relevant logs, and trace only the corresponding cause. Redact secrets. Separate immediate error from unverified deeper causes. Record limitations and deliver concise findings.

## Results
- Persisted history contains 48 entries. Sorting by createdAt confirms newest failure ID 2026-10-22T23:04:30.096Z-20261023, corresponding to 2026-10-23 08:04:30.096 JST. Status ERROR, dryRun=false, candidate 6bf869bcc1a0b19a5a178236c60aff6789885637.
- Live console binding was obtained from the existing service configuration. Initial loopback reads failed because the server binds its designated LAN address. Read-only GET /api/history on that binding returned the same newest entry and 48 total records; GET /api/jobs/active returned busy=false, job=null. No new task was started.
- Steps 1 through 11 completed. Static delivery prerequisites explicitly contain riven-45 and vmiss-64 PASS. Local release preflight completed in 402182ms.
- Step 12 test-game-backend failed in 1814ms: check-docker-engine.cjs W10= could not connect to npipe:////./pipe/dockerDesktopLinuxEngine because the pipe was missing. The PowerShell nonzero guard prevented docker build execution. No Maven/build result exists for this failed attempt.
- All production-action steps in this history entry remain pending, including image upload, static staging, migrations and deployment.
- Current read-only repetition of the exact helper command returned exit 0 and docker_build_engine=PASS OSType=linux. This establishes current shell readiness only, not a rerun of the release or guaranteed future engine uptime.

## Final Review

- PASS: latest persisted and API records reconciled; exact failure step, time and reason established.
- PASS: previous certificate failure distinguished from latest engine failure. No newer release or active task was observed.
- UNRESOLVED: historical cause of Docker Desktop exit remains unestablished. Prior recovery is documented in 20261022-docker-build-failure-investigation.md.
- No runtime changes, startup, backend build, production retry or code edits performed. Documentation references and scope manually reviewed; git diff --check is the applicable static check.
