# 文档索引

当前文档对应 **0.2.1 Preview**，版本更改见 [更新记录](CHANGELOG.md)。

## 使用与运行

- [项目 README](../README.md)：本地预览、账号、玩法、交互教程和验证命令。
- [Linux 与 NAT 部署](DEPLOYMENT.md)：生产部署、端口映射、HTTPS、备份与恢复。

## 开发资料

| 文档 | 内容 |
| --- | --- |
| [API](API.md) | HTTP 与 Socket.IO、鉴权、比赛、提示、结果和预加载协议 |
| [架构](ARCHITECTURE.md) | 前后端模块、共享规则、数据存储和单实例运行边界 |
| [素材](ASSETS.md) | 原始源库、仓库内素材、导入生成物及别名统计口径 |
| [参考动效](REFERENCE-MOTION.md) | 参考来源、运动参数与复刻边界 |

## 交互教程代码

教程位于 `/#/tutorial`，是独立的本地模拟，不创建正式比赛或写入排行榜。

| 文件 | 职责 |
| --- | --- |
| [Tutorial.tsx](../apps/web/src/Tutorial.tsx) | 16 步正式界面引导、自动字幕与收缩闪烁圆圈 |
| [TutorialScoreRules.tsx](../apps/web/src/TutorialScoreRules.tsx) | 最终结算中居中淡入淡出的 7 段计分说明及真实成绩牌演示 |
| [TutorialEndTransition.tsx](../apps/web/src/TutorialEndTransition.tsx) | 黑屏结束文字与自动返回主界面的淡入淡出 |
| [TutorialBlackTransition.tsx](../apps/web/src/TutorialBlackTransition.tsx) | 欢迎文字、难度选择与猜图之间的黑屏转场 |
| [tutorial-runtime.ts](../apps/web/src/tutorial-runtime.ts) | 本地教学请求、血量、计分、受控计时与页面跳转；不访问正式比赛接口 |
| [play-runtime.ts](../apps/web/src/play-runtime.ts) | 通过 React 上下文为共享页面注入教学依赖，正式模式继续使用原接口 |
| [tutorial-songs.ts](../apps/web/src/tutorial-songs.ts) | 四首教学曲目的资源、别名与提示 |
| [tutorial-model.ts](../apps/web/src/tutorial-model.ts) | 教学步骤、演示参数和教程完成标记 |
| [tutorial-refresh.ts](../apps/web/src/tutorial-refresh.ts) | 校验标签页临时恢复数据，区分刷新和重新访问 |
| [tutorial-media.ts](../apps/web/src/tutorial-media.ts) | 共享图片下载与缓存，隔离画面取消和整个教程退出 |
| [tutorial-device.ts](../apps/web/src/tutorial-device.ts) | 识别手机与触摸设备，跳过鼠标悬停教学 |
| [original-image-cache.ts](../apps/web/src/original-image-cache.ts) | 已解码原图的 32 MiB 共享缓存、淘汰与引用释放 |
| [original-images.ts](../apps/web/src/original-images.ts) | 正式游戏与教程的原图下载复用、结算顺序预载 |
| [LOSSLESS-ASSETS.md](LOSSLESS-ASSETS.md) | Raw/EZ 源 WebP 校验与运行图片导入参数 |
| [tutorial.css](../apps/web/src/tutorial.css) | 教程页面、入口与交互演示样式 |

计分和综合牌直接复用 `packages/game-core`，生命及难度规则复用 `packages/contracts`。教程运行状态保存在组件内，离开文档时用 `sessionStorage` 暂存刷新恢复数据；刷新续接当前步骤，关闭后重新访问回到游戏主界面，不保留进度。完成标记使用独立的浏览器存储键。

教程相关测试位于 [tutorial-model.test.ts](../tests/tutorial-model.test.ts)、[tutorial-score.test.ts](../tests/tutorial-score.test.ts)、[tutorial-runtime.test.ts](../tests/tutorial-runtime.test.ts) 和 [tutorial-refresh.test.ts](../tests/tutorial-refresh.test.ts)，运行命令见项目 README。

- [实时生成题图与素材迁移](DYNAMIC-ARTWORK.md)
