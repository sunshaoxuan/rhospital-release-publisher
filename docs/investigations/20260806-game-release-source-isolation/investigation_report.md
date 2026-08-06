# 游戏发布源准备失败调查

## 结论

2026-08-06 任务 `2026-08-06T13:31:54.858Z-20260806` 在第 8 步 `validate-game-sso-source` 停止。失败前完成的 7 个步骤均为本地读取或校验，生产动作执行数为 0。线上游戏继续运行 `hospital-backend:20260805`。

失败命令使用开发仓库执行 `git status --porcelain --untracked-files=all -- ... src/main ...`，检测到两张妙手仁心图片和 `TopInfoPanel.js` 的未提交修改。目标提交为 `7d8aeae7`，这些工作区修改不属于目标提交。发布器直接在开发目录切换提交和构建，使保留开发改动与发布已提交版本发生冲突。

## 修复

每个执行任务先在发布器仓库 `.release-worktrees/<任务ID>` 创建目标提交的 detached Git 工作树。源码门禁、测试、镜像构建和发布命令只在隔离工作树运行。计划生成、变更分析和提交选择继续读取开发仓库。任务成功、失败或取消后通过 `git worktree remove --force` 清理隔离目录。

工作树路径和任务 ID 均执行边界校验，目标必须是完整 40 位提交号。创建失败时任务在任何构建或生产动作前停止。清理失败会保留警告与路径，供人工处理。

## 线上状态

生产 Swarm 服务镜像为 `hospital-backend:20260805`，期望副本 1，更新状态 completed，运行任务持续 45 小时且错误为空。`https://rhospital.cc/run/newGame` 返回 HTTP 200。

## 第二次任务续查

任务 `2026-08-06T14:10:58.026Z-20260806` 已通过隔离发布源阶段，在 `test-game-backend` 的 Docker Maven 构建中停止。919 项测试有 1 项失败，失败类为 `BillboardConcurrencyUiContractTest`。目标 `PropScene.js` 中点击锁、单次刷新和 finally 释放逻辑均存在。测试直接匹配带 LF 的多行字符串，Windows Git 系统配置 `core.autocrlf=true`，干净工作树检出为 CRLF 后产生假失败。

页面第一阶段未变绿还有独立的阶段映射错误。`save-run-config` 在计划中位于 `test-game-backend` 之后，页面曾把它归入“准备发布源”。修复后该步骤归入“批量测试与构建”，阶段完成颜色与真实执行顺序一致。
