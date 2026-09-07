# Test Results

| 检查 | 结果 | 说明 |
|---|---|---|
| 修改前正式探针 | FAIL | VMISS 冷缓存探针连续两次报告 `Framebuffer Unsupported` |
| Riven SwANGLE 单探针 | PASS | FirstFloor，750 个资源，零业务错误 |
| VMISS SwANGLE 单探针 | PASS | FirstFloor，750 个资源，零业务错误 |
| 静态交付聚焦单元测试 | PASS | 19 项通过 |
| 修改后生产双前置六探针 | PASS | 6 项均一次成功，网页与 Steam 均到达 FirstFloor |
| 全量发布器测试 | PASS | `npm test`，164 项通过，失败 0 |

真实验收只访问现有生产页面和缓存链路，没有上传镜像或执行容器切换。
