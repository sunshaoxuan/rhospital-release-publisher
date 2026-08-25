# Test Results

## 生产运行

| Check | Result |
|---|---|
| Runtime image | `hospital-backend:20260825` |
| Runtime tag | `20260825` |
| Replicas | 1 |
| Secret mappings | 22 |
| Container health | healthy |
| Local ingress | HTTP 200 |
| Compose config | PASS |
| Stack config | PASS |
| Live Swarm 22 mapping contract | PASS |
| Zero-replica deploy guard | PASS, deploy command not called |
| Rollback policy online update probe | 80 HTTP 200, 0 failures |
| Authenticated `/run/newGame` HTML | HTTP 200 |
| `window.GAME_VERSION` | `20260825` |
| Rendered footer source | `20260825` |

## 发布器

| Check | Result |
|---|---|
| Core targeted tests | 89 passed |
| Real OpenSSH stdin probe | PASS |
| Full `npm test` | 160 passed, 0 failed, 0 skipped |
| Game full-flow isolated acceptance | 34 steps, 32 executable, 38 invocations, PASS |
| Forum full-flow isolated acceptance | 17 steps, 16 executable, 20 invocations, PASS |
| Isolated tool trace | 71 calls, 32 SSH, 26 Bash syntax checks, PASS |

The final full suite was rerun after the Secret template correction and Windows integration timeout adjustment. The final isolated acceptance report was generated from the same final source state.

## Remaining visual limitation

真实登录 WebGL 探针在测试浏览器中连续两次报告 `Framebuffer Unsupported`，因此没有完成 FirstFloor 场景渲染验收。独立 WebGL 能力探针为 PASS，生产后端、登录 HTML、游戏版本、健康检查和 HTTP 均为 PASS。该失败作为浏览器基础设施证据保留，没有被改写成页面成功。
