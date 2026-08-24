# 发布器全流程隔离验收调查

## 结论

2026-08-25 的第二轮隔离验收通过。游戏计划 34 步中有 32 个可执行步骤，执行器调用 38 次。论坛计划 17 步中有 16 个可执行步骤，执行器调用 20 次。所有可执行步骤、validationCommand 和 recoveryOnly 步骤均已进入真实 PowerShell 执行器。

本轮没有上传镜像，没有替换生产镜像，没有改动生产数据库、Compose 或 Swarm 运行状态。

## 根因与修复

1. PowerShell 主脚本已从 stdin 传递，SSH 仍将超长 Base64 放入 argv，导致 Windows 启动 `ssh.exe` 失败。
2. SSH 命令改为通过 stdin 传递 Base64。
3. Base64 赋值初版使用通用 shell token，安全字符串没有强制加引号，PowerShell 会把赋值右侧解析为命令。现已使用 PowerShell 单引号字面量。
4. 论坛首轮验收发现隔离 Git 替身使 Git Bash 派生路径失效。源码校验现优先使用 `GIT_BASH_PATH`，保留从 Git 路径派生的默认行为。

## 验收分类

| 分类 | 含义 |
|---|---|
| ISOLATED_REAL | 原始命令进入真实 PowerShell，外部工具由隔离工具链接管 |
| SIMULATED_DESTRUCTIVE | 上传、备份、迁移、Compose 替换、部署、清理和回滚命令进入 PowerShell，外部破坏性动作由隔离替身执行 |
| METADATA_ONLY | 步骤只保存发布器内部校验结果，没有可执行命令 |

## 局限

本轮证明 Windows PowerShell 语法、超长脚本传输、步骤覆盖、顺序和远程 Bash 语法可通过。隔离验收不代表生产 Docker、数据库或网络的实际写入结果。正式发布仍由原有失败关闭门禁保护。
