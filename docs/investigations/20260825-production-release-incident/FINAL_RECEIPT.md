# Final Receipt

Status: production recovered, publisher verification complete.

Production runs `hospital-backend:20260825` with `IMAGE_TAG=20260825`, one healthy replica, 22 Secret mappings and HTTP 200. The repaired Compose matches the runtime image, replica and Secret contract and has passed both configuration parsers. No second Stack deploy was performed after the Compose repair.

Publisher changes add CRLF-safe SSH Base64 transport and fail-closed production Compose and runtime Secret validation. `npm test` passed 160 tests. Game and forum full-flow isolated acceptance passed all 58 executor invocations. Real OpenSSH returned PASS. Authenticated game HTML returned HTTP 200 and both runtime and footer versions equal `20260825`.

The WebGL scene probe recorded `Framebuffer Unsupported` in the controlled test browser after one isolated retry. This limitation is retained in `test_results.md`; it does not change the verified service, Compose, login HTML or version results.
