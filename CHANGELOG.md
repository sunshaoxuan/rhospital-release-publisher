# 变更记录

## 2026-07-31

1. 游戏发布新增内容寻址静态资源交付链。目标提交先构建独立资源清单与对象镜像，再按运维仓库双前置清单向 Riven、VMISS 增量预置并逐文件复算完整 SHA-256；应用切换前逐地址要求 HTTP 200、`X-Cache=LOCAL` 与 `X-Asset-Source=gate-object`，Service Worker 额外要求根作用域许可。任一文件失败时禁止更新 Compose 和执行 Swarm 热滚，旧 HASH 对象保持可读。
2. 游戏发版影响评估新增强制步骤 `verify-game-static-assets-predeploy`，发布计划与单元测试同步覆盖构建、预置、验证和生产动作分类。本次只修改发布器源码与配置读取逻辑，没有执行镜像上传、前置写入或生产发布。
