# 灾备镜像步骤的隔离控制台验收

Chrome 以桌面 1440×900、手机 390×844、窄屏 320×800 渲染本机隔离发布器。截图所示的 `ea5046b9` 为只用于浏览器验收的本地 fixture 提交，执行与前端文件字节与待交付候选相同，Git blob 分别为 `7c1e42465f76d000516798884fbc8b4151a9c4e1` 和 `7420b23de8844e650e0671e16c367f372afa6717`。显示游戏当前镜像和运行状态的查询使用固定替代响应。发布计划与步骤详情使用真实本机 API、应用提交和历史副本。无执行发布请求。

三个视口均已生成计划，打开「灾备镜像」阶段、读取检查要求并展开原始命令。六次计划请求及三次步骤详情请求均返回 HTTP 200。原始浏览器记录包含一条 favicon 404，现网同一路径也返回 404，其他页面资源与 API 正常。无页面脚本异常。功能检查 PASS。

概览和详情无横向溢出。三个视口的阶段按钮可点区域均为 117×44px，胶囊内接可用框中的文字四边余量为左 4、上 8、右 5、下 8px，实际字形中心偏差为横向 0.5px、纵向 0px，均在 1.2px 预算内。按钮旁边的状态标签为静态文本。几何检查 PASS。

检查全部概览与详情的段落、标题和外框。320px 的原生下拉框压缩选项文字，所选步骤的全标题紧接于其下完整换行。新增阶段与相邻阶段对齐，阶段标题、操作和详情校验文字均可见。Sub2API 模型目录不可达，由主 Agent 检查实际截图。视觉检查 PASS。

- [桌面概览](desktop-overview.png)、[阶段原图](desktop-phase.png)、[详情](desktop-details.png)和[详情原图](desktop-step.png)
- [手机概览](mobile-overview.png)、[阶段原图](mobile-phase.png)、[详情](mobile-details.png)和[详情原图](mobile-step.png)
- [窄屏概览](narrow-overview.png)、[阶段原图](narrow-phase.png)、[详情](narrow-details.png)和[详情原图](narrow-step.png)
- [浏览器原始记录](browser.json)与[几何测量](geometry.json)
