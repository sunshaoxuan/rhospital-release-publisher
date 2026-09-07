# 游戏静态交付探针重复失败调查

## 结论

发布器使用旧式 `--use-gl=swiftshader` 启动受控 Chrome。离线能力探针能够创建 framebuffer，真实 Phaser 页面在创建 1520×1000 渲染目标时会间歇报告 `Framebuffer Unsupported`。失败出现在 Riven 或 VMISS，业务资源响应和生产运行合同没有对应故障证据。

Chrome 启动方式已更新为 Chromium 当前文档列出的 SwANGLE WebGL 组合。修改后的生产双前置六探针全部一次通过，进入 FirstFloor，资源响应、缓存头、网络错误和应用运行错误门禁保持不变。

## 行为路径

1. `validate-game-static-delivery-prerequisites` 使用正式 Chrome 参数执行离线 WebGL 能力检查。
2. `verify-game-static-delivery` 对 Riven 与 VMISS 分别执行网页冷缓存、网页暖缓存和 Steam 探针。
3. 旧启动参数在真实 Phaser framebuffer 创建阶段出现间歇性环境错误。
4. SwANGLE 参数在两台前置和两种域名上完成六次真实页面加载。

## 修改范围

1. `scripts/verify-game-static-delivery.mjs` 更新 Chrome 软件 WebGL 参数。
2. `test/gameStaticDeliveryVerifier.test.js` 固定启动参数契约。
3. `README.md` 与 `CHANGELOG.md` 更新运行说明。

## 风险边界

此次修改没有放宽任何发布断言。FirstFloor、资源状态、缓存头、源站预算、Steam ES 模块、网络错误和应用运行错误仍会失败关闭。生产复测只加载页面并预热既有静态缓存，没有修改镜像、容器、数据库或生产配置。
