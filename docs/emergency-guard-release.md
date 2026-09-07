# 急救中心发布验收

2026-09-07 增加成对检查 `verify-game-emergency-guard` 与 `verify-game-emergency-guard-runtime`，缺少其中一项即拒绝计划。

前置证据检查在完整后端测试后、构建前执行。要求业务仓库 `release/emergency-guard-readiness.json` 协议与总体状态通过，正常脚本回放、历史回放、PostgreSQL 并发、真实浏览器、Nginx、生产测试身份六项文件的摘要匹配，并完整覆盖发布影响评估中的运行路径。文本文件统一 LF 计算 SHA256，以兼容 Git 换行转换；二进制截图按原字节计算。缺少、越界、改变或遗漏的证据均失败关闭。

生产能力检查在最终运行检查之后执行，读取原受控静态交付凭据文件，兼容该文件既定的纯 token 与 `token=` 格式。经 SSH stdin 在源站回环 8190 执行只读医院查询预检；204 或合法查询冷却 403 必须携带 `emergency-hospital-v1`。不调用游戏业务，不输出 token、密码、完整响应或上游错误文本。

这两个检查不会自动开启 Gate。前置配置和逐台发布归 `C:/workspace/rhopital/deploy/emergency-guard`；每台开启前重新验证新后端协议、配置漂移和模块支持。旧应用回滚先关闭前置联动。删除本次发布器检查前，应先确认业务发布评估和 Gate 已不再引用此协议。

验证：`npm test` 覆盖检查注册、顺序、证据缺失/变更/越界、文本换行归一化与凭据传输边界。修改应用规则不在本仓库处理。
