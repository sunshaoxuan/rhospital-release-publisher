# 官方 Jev 接入验证

日期：2026-09-18。

## 实现与数据范围

官方 SDK `@typesafe-ai/sdk@0.6.0`，服务地址 `https://api.typesafe.ai/v1/systemone`，默认模型 `jev-latest`。固定 Choice 问题保持四类排查建议。删除 Qwen chat-completions/logprobs 路径，固定官方服务地址，独立 DPAPI 配置文件避免复用旧网关凭据。

输入仅含固定枚举的执行结果及步骤信号，最多 32 项观察。模型不会收到原始日志、路径、命令或凭据。详细根因诊断不在本次实现范围内。

## 已执行验证

- `npm test`：217 项通过、0 项失败，耗时约 170 秒。第一次全量运行发现两个复制仓库的子进程测试缺少新增 SDK；显式提供测试 checkout 的依赖搜索路径后，完整复验通过。
- 依赖锁文件已纳入发布器运行指纹，新增用例验证其变更会改变指纹。`git diff --check` 通过。
- SDK 请求契约与响应校验：使用真实官方 SDK 和模拟 HTTP Response。涵盖版本、标签、概率边界与总和、服务置信度、超时、401/403、429、错误脱敏及旧地址拒绝。
- Windows 配置：PowerShell 语法解析通过；使用明确的测试用假密钥执行加密保存、Node 解密读取、停用，往返检查通过。
- 浏览器：`DIAGNOSTICS_FIXTURE=1 JEV_FIXTURE=1`，实际页面运行在 `127.0.0.1:18789`。历史 held 记录复核后显示模拟分类与模型版本，状态保持 RECOVERY_REQUIRED；warning 记录复核后显示官方凭据未配置。
- 浏览器网络：历史复核 POST 及刷新 GET 返回 200，无观察到的失败请求；控制台无 error/warn。
- 响应式：390×844 视口，clientWidth 与 scrollWidth 均为 375，无横向溢出。桌面和手机截图已经人工检查。
- 截图 `desktop-fixture.png`、`mobile-fixture.png` 使用模拟概率；截图中的 Jev 版本和数字均来自测试响应，不构成官方模型调用证据。

## 当前阻塞

用户确认尚无 TypeSafe 或 Vercel AI Gateway 账户；对应常用凭据环境变量亦未配置。本次没有获得实际 Jev 响应，历史发布的真实模型效果、延迟及准确性待账户开通后验证。发布器可展示未配置原因，执行证据诊断继续工作。

## 后续验收

获得 TypeSafe 访问权限后，以服务运行账户执行 `scripts/configure-release-diagnostics.ps1` 并隐藏输入密钥；空闲受控重启加载配置。选择历史失败记录复核，确认实际 `semantic.provider=typesafe`、版本、概率与状态保持，再收集人工标注案例比较效果。
