# 部署采样、历史失败与状态区修复

## 主目标与用户要求

追查截图中部署采样失败及20261117游戏执行ERROR的真实原因，修复本仓库所拥有的问题；清楚分开当前部署状态与历史执行结果。继续引用20261117-console-layout-and-plan-latency.md的已有UI交付，不重复其已验证功能。本批从069a7699开始，使用独立分支。

## 方法与边界

先读取实际发布器版本、活动任务、状态接口、失败历史/任务与服务日志，连接采样配置和执行代码。只输出必要错误与身份，认证秘密不进入日志。修复范围限发布器采样器、状态投影/视图和直接测试；外部应用或生产问题仅只读定位并提出具体处置边界。保留历史失败原记录，不启动应用发布、迁移、部署、回滚或产品全量。权威插件标准与手册保持现有支持边界。

## 批次成员与验收

1. 采样：记录真实错误、输入与根因；针对性修复；成功及错误负例，旧快照明确标识，实际环境只读复核。
2. 20261117执行：定位原记录ID、候选、首次失败步骤及原始错误；修复发布器拥有的阻塞，证明相关输入/协议正确。外部环境或应用修改单列，禁止伪造原执行成功。
3. UI：当前部署和历史执行独立区域，采样错误紧随当前部署，历史时间/结果/失败步骤归属清楚。桌面1440x1000及手机390x844，无水平溢出；可见边框完整；按钮最小44px、间距6px、字形内边距3px、视觉中心误差min(2px,字形高10%)。实际运行功能、控制台、网络、响应式、整体与局部截图及Gemini复核分开记录。

## 验证规划与停止条件

追踪根因后冻结变更路径、直接消费者、廉价前检、原生门禁检查并集及耗时。现有PASS按拥有输入复用，原生提交/推送承担测试，不预跑同一套。正式验证开始后只修直接阻塞，记录失效输入和最小重跑范围。必需项通过即收尾源码交付与本任务清理。服务启用需沿用现有安全更新流程与空闲保护；操作系统权限不足则明确未完成项。

## 当前状态

首轮原生f30a093通过46断言：policy10/10、runner10/10、console15/15、outcome11/11；documents静态通过。实际只读schema2采样及本地validator确认当前2026111501健康，原服务尚未更新。浏览器复用仓库现有Chrome/CDP工具，因本会话无CUA/node_repl工具，使用独立headless浏览器测试本次实际视图模块及CSS，原始生产快照/历史只读复制，固定采样时钟；失败状态显式注入，非生产操作。4个桌面/手机成功/失败场景无JS/网络错误，展开历史ID成功。Gemini3.1Pro上游失败；3.8Flash视觉请求成功。主审核：桌面卡四边完整，模型边框缺失判断与截图不符；移动镜像标签换行完整、详情可复制，不改变；采纳历史ERROR直接归属标题，补“执行失败”及目标版本标签，记录时间明确。失效输入public/release-status.js、styles.css及其UI断言；最小原生重跑documents+console15+outcome11，policy/runner仍可复用，预计12秒。无后端业务测试。

根因证据：实际服务仍e194且空闲。只读SSH采样退出0，生产镜像hospital-backend:2026111501、副本healthy、服务version50869；旧validator强制@sha256并将仓库摘要与配置ID混比，拒收合法标签。改用schema2独立imageId，采样前后核对服务及解析出的配置ID，旧schema1缓存重新采样。原历史2026-11-17T04:01:24.973Z-20261117在validate-game-source-impact失败，UNMAPPED_PLUGIN_CHANGE: release/release-impact.json，候选f6431453；生产动作done数量0。该提交清单的影响映射为空；当前游戏HEAD已明确映射到application-release-contract.release-plugin-producer。保持历史ERROR，修复状态展示，应用仓库无须本次修改或重跑。

范围冻结：src/releaseOutcomeStatus.js、scripts/read-game-runtime-status.py、public/release-status.js、public/styles.css、test/releaseOutcomeStatus.test.js，及实际登记该既有回归所需的src/changeValidationPolicy.js/test/changeValidationPolicy.test.js，CHANGELOG及本记录。直接消费者：状态API、状态视图、只读Python采样器。原状态测试文件未被当前原生门禁登记，补入publisher-outcome叶子，只拥有其4个直接输入；不增加产品检查。选中documents、policy、runner、console、outcome；先Node/Python语法与映射廉价前检，原生提交执行并集一次，预计45秒，超过90秒报告卡点并停止追加检查。后端Core、Source、业务检查及通用worker内核均无变更。Claude5.5-high无可用账户，DeepSeek Flash/high完成非视觉身份/负例建议，主Agent复核采用配置ID和仓库摘要分离、TOCTOU负例与错误码白名单。视觉仅交Gemini。

开始只读定位。功能、几何、视觉及总体验收均待验证。
