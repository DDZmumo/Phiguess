# Phiguess

Phiguess 是一个参考 Phigros 界面与动效的曲绘猜歌网页游戏，支持单人挑战、多人房间和排行榜。玩家根据不同抽象程度的曲绘，在限定时间内输入歌名或别名。

**当前仓库仅上传 `README.md`。** 下文介绍本地开发版本；源码、运行素材、数据库及部署配置尚未上传，暂不能仅通过克隆此仓库运行游戏。运行命令适用于后续包含完整源码的工作目录。

本地版本已包含前端、后端、素材导入、共享协议和部署配置，并接入 57 首歌曲、60 组四档曲绘版本及 60 张原图。项目仍在开发，视觉细节与玩法规则持续调整。

技术：React、Vite、Zustand、GSAP、TypeScript、NestJS 11、Socket.IO 4、PostgreSQL 17、Caddy。数据库采用 `pg` 参数化查询和版本化 SQL 迁移，便于直接检查计分事务与约束；暂未引入 ORM、Redis 或微服务。

## 直接预览（无需 Docker）

```powershell
npm.cmd ci
npm.cmd run preview:game
```

打开 `http://localhost:5174`。启动页点击后进入账号主界面。首次填写昵称，点击勾号建立游客档案；点击“单人游戏”进入黑底发光的难度选择。选定难度后，难度字母移到中央并停住，挑战设置从黑暗中浮现，可选择题数、时限和适用难度的血条开关。确认后，设置文字先淡入黑暗，再继续滚动转场并正式开题。

此命令启动项目内 PostgreSQL（55433）、后端（3000）和 Vite（5174）。检测到完整本地曲库时自动使用 `phiguess_local` 数据库，运行素材位于 `storage/assets/`。按 Ctrl+C 停止。开发数据库位于 `storage/preview/db/`，不安装系统服务，也不需要 Docker。

需要更换前端端口时运行 `npm.cmd run preview:game -- --port=5180`；脚本会同步设置前端监听端口、后端 CORS 与 Socket.IO 允许的访问来源。

`npm.cmd run preview:game -- --demo` 使用独立的 `phiguess_preview` 合成演示库，不与实际曲库混用。没有本地曲库时也会自动使用演示库并显示标识。当前数据库连接配置保存在被忽略的 `storage/preview/runtime.env`，不要提交或分享。

界面铺满浏览器：1210×834 是布局参考基准，横向区域随窗口扩展，文字不做非等比拉伸；窄竖屏改为纵向布局。启动页与账号资料面板使用 Raw 原图库背景，每次刷新重新选图。完整源码中的 `docs/REFERENCE-MOTION.md` 记录参考视频、运动测量与复刻边界。

## 已实现

- 游客会话：随机 Bearer token，数据库只保存哈希，30 天有效，可注销。
- 曲库与四档素材：EZ 导入 PNG/JPEG/WebP 并规范化为 WebP；HD/IN/AT 导入已经描摹的 SVG。
- 单人游戏：1～10 题、每题 15～90 秒；独立剧情难度选择，AT/IN/HD/EZ 对应外挂/龙比/人类/区区，动画结束后才开始比赛计时。
- 多人房间：房间码、2～8 人、准备、房主开局、相同题图、实时状态、重连获取快照、房间成绩。
- 服务端出题和计分；时间内可多次猜测，答对后锁定得分；提交 ID 幂等，防止重复得分。
- 题图访问鉴权：当前参与者、当前回合、开始时间之后才可读取；不公开素材目录。
- 历史成绩、健康检查、输入校验、基础限流、同源配置。
- 账号主界面、章节解锁风格的四档难度选择、排行榜、设置、多人房间、猜图界面、结算。
- 歌名自由输入（支持别名和大小写/全半角归一化）；框内提示章节范围、降低题图难度、锁定章节与曲师。EZ 仅有范围与身份两项提示。
- 有进行中挑战时，“开始挑战”置灰；同样式的“继续上次挑战”显示在其下方。
- 排行榜按模式、开局难度、题数、时限分组；每日挑战已移除。
- 左侧题目轨道：未猜出的名称显示乱码，猜中的显示真实歌名并随下一题进入向下移动。
- 可上传、更换头像，PNG/JPEG/WebP，最大 3MiB；保存后账号页与游戏右上角同步，刷新仍保留。
- 社区别名本地判题与按需同步；同首歌的不同曲绘版本不会导致同局重复抽歌。
- 答对后沿斜向边界扫除抽象曲绘，揭晓原图；原图只在服务端确认本人答对后下发。
- 曲绘、曲名和提交按钮的噪域共用顶层画布与渲染器；相邻区域合并，支持随时间覆盖、交互光效及换题退场。
- 顶部 LIFE 生命显示使用程序绘制尖刺、泛光和实时字体。EZ 不显示，HD／IN 可选，AT 强制开启；目前仅接入视觉与显示开关，尚未接入扣血、回血及归零结束规则。
- 已结束挑战可恢复最后一题的题图与已有噪域；刷新恢复仍受参与者鉴权约束。

## 本机开发（无需 Docker）

需要 Node.js 22.14+。在项目根目录执行：

```powershell
npm.cmd ci
npm.cmd run db:local
```

这个终端启动项目内 PostgreSQL，监听 `127.0.0.1:55432`，按 Ctrl+C 停止。数据保留在 `storage/local-db`，不会创建 Windows 服务或开机启动项。首次 `npm ci` 会下载对应平台的 PostgreSQL 二进制开发依赖。

另开终端：

1. 将 `.env.example` 复制为 `.env`。
2. 将 `storage/local-db/database.env` 中的 `DATABASE_URL` 复制进 `.env`，不要提交或分享该文件。
3. 开发环境保持 `TRUST_PROXY=0`。
4. 执行：

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

就绪检查：`http://localhost:3000/api/health/ready`。另开终端运行 `npm.cmd run dev:web`，并把后端 `.env` 的 `PUBLIC_ORIGIN` 设为 `http://localhost:5174` 后重启后端。在导入足够素材前，开局返回 503，这是预期行为。

## 导入歌曲素材

复制 `examples/song.manifest.json`，填入稳定的歌曲 UUID、曲名、别名、版本与四个文件路径。文件路径相对于 manifest 所在目录。示例中的歌曲和文件路径只是占位。

```powershell
npm.cmd run assets:import -- E:\素材\song.manifest.json
```

- 本项目不在线调用图像模型，也不在线执行位图描摹。请提前准备 HD/IN/AT SVG。
- SVG 允许静态路径、分组、基础图形、渐变与裁切；拒绝脚本、外链、嵌入位图、CSS、文本、注释等。导入器报错时先规范化 SVG，不会自动删除可能影响画面的内容。
- 每个 SVG 上限 2 MiB、15,000 元素、64 层。上限是保护阈值，不是推荐素材大小；10Mbps 网络下应尽量压缩到更小。
- 每次导入原子切换同一曲绘变体的四档当前版本；相同版本禁止覆盖。旧版本保留，进行中比赛继续引用旧素材。
- 导入中断可能留下未被数据库引用的文件，不会删除或覆盖已有素材。清理前先核对数据库引用。
- 练习和房间的题数不能超过相应难度的可用歌曲数。
- manifest 中的 `chapter`、`chapterName`、`composer` 用于提示；第二项会为当前玩家降一级题图。提示点击后才返回，不额外增加时间。目前仍按开局难度计分，生命值的扣除与失败规则尚未加入。
- manifest 可增加 `variant` 和 `original`，分别标记同一歌曲的曲绘变体与原图路径；只有同一变体的旧版本会被替换。

完整源码中的 `docs/ASSETS.md` 记录已导入资源、去杂色/描摹参数、来源校验与素材目录。社区别名来源与许可记录位于 `data/providers/phi-plugin/`。这些素材和记录不包含在当前 README 单文件提交中。

## 验证

```powershell
npm.cmd test
```

测试会启动临时的真实 PostgreSQL，执行 SQL 迁移、导入合成素材，并通过真实 HTTP / Socket.IO 连接验证多次猜测、重复提交、题图降级、素材授权、排行榜、房间重连与重启中断。结束后正常停止数据库并清理本轮测试目录。不需要 Docker，不连接你的开发或生产数据库。

测试素材纯属合成色块，不能用来评估最终游戏难度、图像效果或手机性能。

## 部署与接口

以下文档位于本地完整工程，尚未随本次 README 提交上传：

- `docs/DEPLOYMENT.md`：Linux 单机 / NAT 部署。
- `docs/API.md`：HTTP 与 Socket.IO 协议。
- `docs/ARCHITECTURE.md`：设计与当前边界。
- `docs/REFERENCE-MOTION.md`：视频参考、测量与复刻边界。

```text
apps/server/src/      HTTP、鉴权、曲库、比赛、房间与实时网关
apps/web/src/         启动、账号、猜图、房间、设置与结算界面
packages/contracts/  请求校验、房间与比赛快照、Socket.IO 事件类型
packages/game-core/  计分函数、串行处理工具
db/migrations/       数据库迁移
tools/               素材导入、迁移、本地数据库、测试启动器
deploy/              Caddy、systemd 示例
tests/               单元与数据库/网络集成测试
```

GitHub 仓库：[DDZmumo/Phiguess](https://github.com/DDZmumo/Phiguess)。本地 `.gitignore` 已排除 `.env`、数据库、运行素材、依赖与测试输出；本次仅提交 README，其他工程文件保留在本地。
