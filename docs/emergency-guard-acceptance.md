# 急救中心发布检查实施验收

2026-09-07 JST，最终修改候选通过 `npm test`：168测试、0失败。新增检查不涉及发布器UI。

| 意图 | 最终证据 | 结果 |
|---|---|---|
| 证据不完整、变化或越界时停止发布 | `test/emergencyGuardRelease.test.js` | PASS |
| Git文本换行转换保持可验证，实际内容变化拒绝 | 同测试中LF/CRLF及变更断言 | PASS |
| 源文件精确覆盖，测试结果与发布候选绑定 | `verifyEvidence`及业务仓库18路径、6证据检查实测PASS | PASS |
| 生产认证能力检查在最终运行检查之后执行 | `test/releasePublisherCore.test.js`步骤排序与新步骤注册测试 | PASS |
| 凭据仅通过SSH标准输入，无敏感诊断回传 | `test/emergencyGuardRelease.test.js`受控进程替身测试 | PASS |

实施验收 PASS。实际游戏生产切换由业务发布计划另行验收。回滚本次发布器修改可还原该提交，但发布目标要求的两个检查必须保持可执行后才能继续该目标。
