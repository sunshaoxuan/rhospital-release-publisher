# Test Results

## 定向测试

PowerShell 超长主脚本、SSH stdin 超长脚本、全流程继续执行和隔离标志门禁均通过。

## 项目全量测试

`npm test`: 160 passed, 0 failed, 0 skipped.

## 全流程验收

| Target | Status | Steps | Executable steps | Executor invocations | Failed |
|---|---:|---:|---:|---:|---:|
| game | PASS | 34 | 32 | 38 | 0 |
| forum | PASS | 17 | 16 | 20 | 0 |

隔离工具调用 71 次，其中 SSH 32 次。远程 Bash 语法检查 26 份，最长脚本 24768 字符。

## 安全结果

镜像上传、生产镜像替换、生产数据库写入、生产 Compose 修改和 Swarm 热滚均未执行。
