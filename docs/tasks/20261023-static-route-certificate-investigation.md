# Static Route Certificate Investigation

## Goal
Explain reported step 03 certificate failure using current source, gateway configuration and read-only TLS evidence. No token reads, production changes, certificate renewal or release execution.

## Method And Acceptance
Trace prerequisite and route-check boundaries; inspect each configured gateway certificate with the configured domain as SNI; separate verified expiry from unverified renewal causes. Record exact dates and affected endpoint, explain early gate purpose and remaining work.

## Follow-Up: Renewal Root Cause
User requests read-only investigation of why riven-45 did not update its certificate and an operations repair prompt. Inspect scoped environment runbooks, active TLS configuration, certificate metadata, renewal configuration and redacted scheduler/log evidence over SSH. Never print private keys, DNS credentials, tokens or full environment/config dumps. Do not run renewal clients, hooks, reloads, restarts, DNS writes or production releases. Completion requires evidence-backed cause, explicit unknowns and a bounded repair prompt with validation and rollback.

### Follow-Up Findings

- Read-only SSH observation at approximately 2026-10-23 01:52 JST: native nginx and Certbot are present. Enabled nginx configuration /etc/nginx/sites-enabled/rhospital-gate.conf references /etc/letsencrypt/live/rhospital-gate/fullchain.pem and privkey.pem for game/API and BBS listeners.
- /etc/letsencrypt/renewal/rhospital-gate.conf has authenticator=manual and pref_challs=dns-01. Presence-only checks confirm no manual_auth_hook, manual_cleanup_hook, deploy_hook, renew_hook, pre_hook, post_hook or dns_cloudflare_credentials fields. All three renewal-hooks directories are empty. No credentials or private keys were read.
- certbot.timer is active/waiting. Last trigger: 2026-10-23 00:22:10 JST. certbot.service is failed, Result=exit-code, ExecMainStatus=1. Journal entries on October 21, 22 and 23 consistently report: An authentication script must be provided with --manual-auth-hook when using the manual plugin non-interactively. This establishes renewal failure before certificate issuance.
- Disk cert.pem resolves to /etc/letsencrypt/archive/rhospital-gate/cert1.pem, with the same expiry and SHA256 fingerprint recorded above for the expired live leaf. No evidence supports a newly issued certificate at the configured nginx path awaiting reload. Other unused certificate locations were not exhaustively searched.
- Existing SANs: bbs.rhospital.cc, hero-hospital.icu, rhospital-api-services.com, rhospital.cc. Public DNS query to 1.1.1.1 resolves the three hospital names; hero-hospital.icu A and NS return ENOTFOUND. This is a separate issuance-scope risk, not the cause shown by current renewal logs. Zone ownership and domain lifecycle were not independently verified.
- Existing operations documents C:/workspace/rhospital/docs/ENVIRONMENT_INVENTORY.md and CLOUDFLARE_LB.md already record manual DNS-01 without automatic renewal and recommend least-privilege Cloudflare DNS automation. The planned automation is absent from the observed renewal configuration.
- Official guidance checked: https://eff-certbot.readthedocs.io/en/stable/using.html and https://certbot-dns-cloudflare.readthedocs.io/en/stable/index.html. Manual renewal requires an authentication hook; maintained DNS plugins support automation. Cloudflare credentials should be zone-scoped and protected.

### Operations Repair Prompt Requirements

Repair only riven-45 certificate lifecycle with explicit authorization for DNS challenge writes, package installation, issuance and graceful nginx reload. Preserve production routing, load-balancer state, upstreams and strict TLS. Before mutation, privately back up nginx/Certbot configuration, permissions and certificate lineage. Verify current installed versions, authorized zones and SAN requirements. Use the maintained Certbot Cloudflare DNS plugin in the existing installation and narrowly scoped DNS credentials in a root-only file; never log or send secrets. Preserve the rhospital-gate lineage and configured nginx certificate path. Obtain user confirmation before excluding an old SAN; do not recreate retired DNS/domain registration. Configure a deploy hook that validates nginx configuration and gracefully reloads only after successful issuance. Keep the existing timer as the single scheduler. Verify noninteractive staging renewal and deploy-hook behavior with the installed version, then verify production leaf dates, hostname and chain on both endpoints using each supported domain as SNI. Run the exact publisher route-check and require both PASS lines. Record rollback that preserves a valid serving certificate; restoring the expired leaf cannot count as recovered TLS. Update operations runbooks and lifecycle alerting through existing mechanisms, with no general infrastructure redesign or automatic production release.

### Follow-Up Review

- PASS: renewal root cause confirmed by configuration, scheduler and matching journal failures.
- PASS: disk/live certificate identity corroborates that the active lineage was not renewed.
- PASS: repair prompt includes SAN uncertainty, least privilege, reload, renewal validation, release route-check and rollback constraints.
- UNPERFORMED: production repair, staging issuance, new certificate deployment and route acceptance. User requested investigation and a handoff prompt.
- Static documentation validation and commit recorded for this follow-up; no publisher source/UI change.

## Results
User log confirms browser and token prerequisites passed before route-check failed.

- Source: scripts/game-static-assets.mjs:368-407 connects directly to gateway.host:443 with SNI/Host gateway.domain and rejectUnauthorized=true. TLS error is propagated without gateway context. verifyGatewayRoutes at :427 probes gateways sequentially and stops on the first rejected probe.
- Configuration: C:/workspace/rhospital/release/game-static-gateways.json selects riven-45 first and vmiss-64 second, both with rhospital.cc SNI.
- Real read-only TLS probes observed at 2026-10-22T16:44:44.766Z (2026-10-23 01:44:44 JST). Strict verification on riven-45 / 45.94.40.77 failed with CERT_HAS_EXPIRED. Metadata-only TLS inspection retrieved the leaf expiry 2026-10-22T08:36:10Z (2026-10-22 17:36:10 JST). Leaf SHA256: 7D:C6:4D:9B:88:D1:79:78:7D:94:42:C4:57:8E:37:62:6C:89:E4:0F:CE:82:18:7F:7E:25:2E:F0:8D:2F:C2:C5.
- Strict verification on vmiss-64 / 64.83.37.55 passed. Leaf validity: 2026-10-21T11:24:03Z through 2027-01-19T11:24:02Z (expiry 2027-01-19 20:24:02 JST).
- Metadata inspection used a separate non-enforcing TLS handshake with no HTTP request, credentials or token. Production scripts and their strict TLS policy were unchanged. No asset-route PASS is inferred from successful TLS alone.
- Official error semantics: https://nodejs.org/api/errors.html defines CERT_HAS_EXPIRED as notAfter before current time.

## Final Review

- PASS: immediate failure is the first configured gateway serving an expired leaf certificate. Early readiness checks precede expensive work by design.
- PASS: browser/token prerequisites remain independently passed in the supplied log.
- PASS: explanation and precise affected host/date established from real TLS probes.
- Unresolved: renewal, certificate deployment and proxy reload causes require gateway-side investigation. No claim that automatic renewal failed.
- Not performed: SSH configuration inspection, renewal, proxy reload, static-route rerun or production release. These exceed the read-only diagnosis needed here.
- Documentation validation: staged git diff --check and manual reference/scope review. No executable source changes; npm test and UI verification are not applicable.
