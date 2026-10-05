# SMTP Probe Verification, 2026-10-05

## Scope

Publisher code, tests and documentation only. No production release, application
restart, database mutation, standby activation, traffic switch or email delivery.
SMTP host, identity and Secret were not modified.

The user prioritizes A-only publishing. External SMTP authentication investigation
is paused. Selected assessment checks remain mandatory; B readiness is required
only in explicitly requested dual-node mode.

## Implementation

Replace fixed sleeps and aggregate OpenSSL responses with ordered Python standard
library calls. Validate the TLS trust chain and hostname. Keep the existing PLAIN
mechanism with one attempt, so an authentication rejection cannot be hidden by a
subsequent LOGIN disconnect. Fail closed if PLAIN is not advertised after TLS.
Run MAIL FROM and RSET only after authentication. No RCPT, DATA or email is sent.
Only stage, numeric code, exception class or PASS is emitted. SMTP error payloads,
password and account identity are excluded from diagnostics.

## Read-Only A Observations

- Initial automatic-login draft: authentication disconnected.
- Server advertised PLAIN and LOGIN. Explicit PLAIN returned auth code 535.
- Challenge-first PLAIN raised a Python decoding error. A fixed EHLO identity
  still returned 535. These diagnostic variants are not retained in runtime.
- The committed OpenSSL probe also failed, reporting response codes ending in 535.
- Existing Secret read matched the complete file after terminal newline removal;
  no CR or multiple lines were present. Only comparison booleans were printed.
- Local working-tree SMTP host, username and From differed from the running image's
  base application.properties. Port matched. Bundled prod profile did not contain
  mail overrides; no SPRING_MAIL environment keys were observed. Complete loaded
  Spring configuration precedence was not established.

Those early diagnostics used `latest` from the local working tree. Its mail
identity differs from the actual selected `origin/master` candidate
`7d94300b0b9d821eb93ea9b23968736f67188081`. Those authentication failures cannot
be attributed to that candidate or to current production business mail.

The final generated probe resolved identity from that exact candidate commit and
executed on A: `game_smtp_sender=PASS`, exit code 0. EHLO, verified STARTTLS, TLS
EHLO, AUTH PLAIN, MAIL FROM and RSET all completed successfully. No email or
configuration change occurred. This is real SMTP envelope-probe verification;
application release, business email delivery and dual-node deployment acceptance
remain separate.

## Local Checks

- Generated Python execution: 14 cases passed, including success, absent or
  duplicate healthy containers, empty Secret, timeout, EHLO rejection, STARTTLS
  rejection, invalid certificate, TLS EHLO rejection, absent PLAIN, auth 535,
  disconnect, MAIL FROM 554 and RSET rejection.
- Tests execute real smtplib PLAIN encoding against an injected SMTP transport.
  They verify command order, fail-closed exit status, no authentication fallback,
  no post-auth-failure MAIL FROM, required TLS verification and redacted output.
  They do not contact SMTP or Docker and are not live deployment acceptance.
- Two focused release-plan SMTP tests passed.
- Full `npm test`: 307 passed, 0 failed, 0 skipped, exit code 0;
  duration 996203 ms. JavaScript syntax and Git whitespace checks passed.
- Live publisher version and A plan results are reported in the task's final
  completion response after the tested changes are committed.

## Remaining Dependencies

The exact candidate SMTP probe passed. Future executions must resolve identity
from the bound release commit rather than a different local working tree.
Changing mail-server credentials requires separate scope. The dual-node
infrastructure helper contract remains unimplemented in the
read-only infrastructure repository. Real dual-node deployment is unverified.

## Investigation Correction

The early latest-source probe expanded beyond the user's immediate A-release
priority and was not bound to the selected release. The correction is to bind
all diagnosis inputs to one candidate SHA before attributing results. The actual
publisher plan already resolves mail identity from its bound commit. No source
identity fallback or gate bypass was added.
