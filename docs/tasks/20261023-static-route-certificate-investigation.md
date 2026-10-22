# Static Route Certificate Investigation

## Goal
Explain reported step 03 certificate failure using current source, gateway configuration and read-only TLS evidence. No token reads, production changes, certificate renewal or release execution.

## Method And Acceptance
Trace prerequisite and route-check boundaries; inspect each configured gateway certificate with the configured domain as SNI; separate verified expiry from unverified renewal causes. Record exact dates and affected endpoint, explain early gate purpose and remaining work.

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
