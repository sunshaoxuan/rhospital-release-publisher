# 变更记录

## 2026-08-02

1. 远程前置演练新增已加载 Nginx/OpenResty `/assets/` 路由检查和现有对象 HTTPS 探针，生产主机演练会在临时目录文件操作通过后确认本地对象根目录、`X-Cache=LOCAL` 与 `X-Asset-Source=gate-object` 已生效；预置动作和静态校验日志同时转发 PASS 标记，并在 HTTP 失败时记录服务端与响应头证据，页面说明同步反映路由检查范围。
2. 生产双前置真实对象验收发现 Nginx `try_files` 直接拼接 HASH 目录会丢失对象键。运维模板改为在 `root` 中使用已校验 HASH 后，发布器远程演练同步检查该路径形式和 `try_files $uri`，并继续以 HTTPS 200、`LOCAL` 与 `gate-object` 作为最终证据。

## 2026-07-31

1. 游戏发布新增内容寻址静态资源交付链。目标提交先构建独立资源清单与对象镜像，再按运维仓库双前置清单向 Riven、VMISS 增量预置并逐文件复算完整 SHA-256；应用切换前逐地址要求 HTTP 200、`X-Cache=LOCAL` 与 `X-Asset-Source=gate-object`，Service Worker 额外要求根作用域许可。任一文件失败时禁止更新 Compose 和执行 Swarm 热滚，旧 HASH 对象保持可读。
2. 游戏发版影响评估新增强制步骤 `verify-game-static-assets-predeploy`，发布计划与单元测试同步覆盖构建、预置、验证和生产动作分类。本次只修改发布器源码与配置读取逻辑，没有执行镜像上传、前置写入或生产发布。
