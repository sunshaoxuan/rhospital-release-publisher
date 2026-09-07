# Commands

1. `node scripts\verify-game-static-delivery.mjs --app-tag 20260907 --auth-token-file <controlled-file> --check-prerequisites`
2. 修改前执行正式静态交付验证，复现 `Framebuffer Unsupported`。
3. 使用 SwANGLE 参数分别执行 Riven 与 VMISS 真实页面探针。
4. `node --test test\gameStaticDeliveryVerifier.test.js`
5. 修改后执行正式双前置六探针。
6. `npm test`

受控 token 内容没有进入命令记录、测试输出或调查文档。
