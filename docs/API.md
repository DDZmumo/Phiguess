# HTTP 与实时接口

本文对应当前 `v4-downgrade` 规则。路由以 `apps/server/src/http.ts` 为准，请求校验和公开类型见 `packages/contracts/src/index.ts`，业务权限见 `games.ts`、`rooms.ts`、`auth.ts`。`/api` 是统一前缀，不是带版本号的 URL；下表省略此前缀。

成功 GET 通常为 200，成功 POST 默认 201。校验失败为 400，未登录或会话失效为 401，权限不足为 403，资源不存在或不可用为 404，状态冲突为 409，限流为 429，数据库/素材等暂不可用为 503；上传超限也可能返回 413。比赛快照的时间为 Unix 毫秒，数据库结果的时间为 ISO 字符串。

## 身份、公开资源与个人信息

除标为“公开”的接口外，均需 `Authorization: Bearer <token>`。不要把 token 放进 URL。

| 方法 | 路径 | 权限 | 请求 / 响应 |
|---|---|---|---|
| GET | `/health/live` | 公开 | `{ status: "ok", service: "phiguess", version: "0.2.1-preview" }` |
| GET | `/health/ready` | 公开 | 查询数据库 `matches` 表；成功 `{ status: "ok" }`，失败 503 |
| POST | `/auth/guest` | 公开 | `{ name }` → `{ token, expiresAt, user }`，每次创建新的游客 |
| POST | `/auth/login` | 公开 | `{ name, password }` → `{ token, expiresAt, user }`；用户名不存在时自动注册，存在时校验密码 |
| POST | `/auth/logout` | 当前会话 | 无请求体要求；删除当前 token 对应会话，返回 `{ ok: true }` |
| GET | `/me` | 当前用户 | `{ id, name, accountType, avatarUrl }` |
| GET | `/me/active` | 当前用户 | `{ match: { id, mode } \| null }`；查找内存中进行中的比赛 |
| POST | `/me/name` | 当前用户 | `{ name }` → 更新后的用户；账号用户的登录名也同步改变 |
| POST | `/me/avatar` | 当前用户 | multipart 单个文件字段 `avatar` → `{ avatarUrl }` |
| GET | `/me/history` | 当前用户 | 最近 50 场，按创建时间倒序：`[{ id, mode, difficulty, status, created_at, score, correct }]` |
| GET | `/users/:id/avatar` | 公开 | 当前头像，`image/webp` |
| GET | `/showcase` | 公开 | 随机最多 12 条 `[{ id, url }]`；从已启用歌曲的活动 EZ 记录中选取有 Raw 预览的曲绘，不含曲名 |
| GET | `/showcase/:id/image` | 公开 | 该活动 EZ 曲绘的 Raw 预览，`image/webp`；不接受任意素材 ID |
| GET | `/songs?q=别名` | 公开 | 最多 50 条 `[{ id, title, aliases }]`，按曲名/ID 排序；省略 `q` 视为空串，最长 100 字符 |
| GET | `/leaderboards` | 公开 | 已发布的 Infinity 个人最佳成绩；查询和返回值见下文 |

`name` 去首尾空白后为 1～24 字符；登录名还会做 NFKC 规范化并忽略大小写。密码为 8～128 字符，不会自动去空白。登录密码以加盐 scrypt 保存；会话默认有效 30 天，服务器只保存 token 哈希。`accountType` 为 `guest` 或 `account`，`avatarUrl` 可为空。游客昵称不唯一，游客身份没有密码找回机制；目前没有重设密码或第三方登录接口。账号改名遇到已注册登录名返回 409。

头像只接受单帧 PNG/JPEG/WebP，最大 3MiB、解码最大 1600 万像素；服务端自动旋转、居中裁为 256×256 WebP 并移除原始元数据。URL 带版本参数。头像和公开背景返回 `Cache-Control: public, max-age=86400`。

HTTP 按 IP 限流：全部 `/api` 每分钟 240 次，游客创建每小时 10 次，登录每 15 分钟 20 次，头像上传每分钟 6 次；专属限流与总限流同时适用。

## 开局参数 GameOptions

`POST /matches/practice`、`POST /rooms` 和 `POST /rooms/:code/options` 使用相同的严格对象校验，未知字段返回 400：

```json
{"difficulty":"hd","rounds":5,"roundSeconds":30,"healthCapacity":20}
```

| 字段 | HTTP 校验与默认值 |
|---|---|
| `difficulty` | `ez / hd / in / at`，默认 `ez` |
| `rounds` | 整数 0～20，默认 5；0 表示 Infinity，只允许 IN/AT |
| `roundSeconds` | 整数 15～90，默认 30 |
| `healthEnabled` | 可选布尔值，用于未指定 `healthCapacity` 时选择默认血量 |
| `healthCapacity` | 可选的 `0 / 20 / 50`；显式指定时通常优先于 `healthEnabled` |

归一化规则：EZ 强制 0HP；普通 HD/IN 默认 20HP，传 `healthEnabled: false` 且未指定容量时为 0HP；IN Infinity 强制开启，容量为显式 50 或默认 20；AT 强制 Infinity、每题 30 秒和 20/50HP，传 0HP 也会归一为 20HP。返回的房间选项与比赛快照反映归一化后的值。

前端选项比 HTTP 校验更窄：EZ/HD 为 5、10、20 题和 30、60、90 秒；IN 为 5、10、20、Infinity 和 15、30、60 秒；AT 只有 Infinity、30 秒。不要把这些 UI 选项误写为服务端枚举限制。

Infinity 会在开局时抽取当前全部可用歌曲，每个 `song_id` 随机选一个曲绘变体，再打乱顺序；曲库走完或全部参赛者血量耗尽时结束，不会无限生成新题。固定题数超过可用歌曲数时返回 503。

## 比赛操作

本节全部需参赛者身份。`:id` 为比赛 UUID，`:round` 为从 0 开始的非负整数（最大 2147483647）。同一用户不能同时参与两场活跃比赛。

| 方法 | 路径 | 请求 / 响应与限制 |
|---|---|---|
| POST | `/matches/practice` | `GameOptions` → `MatchView`；创建单人挑战 |
| POST | `/matches/:id/ready` | 无请求体要求 → `MatchView`；首题下载解码后确认就绪，启动开局倒计时 |
| GET | `/matches/:id` | `MatchView`；读取快照，必要时从持久化记录恢复已结束比赛的最后一题 |
| POST | `/matches/:id/guesses` | `{ requestId, round, answer }` 或 `{ requestId, round, songId }` → `{ correct, score, elapsedMs }` |
| POST | `/matches/:id/return` | 无请求体要求 → `MatchView`；只允许单人，普通难度放弃，AT 设置返回限制 |
| POST | `/matches/:id/skip` | `{ round }` → `MatchView`；只允许单人，在开题后跳过尚未答对的当前题 |
| POST | `/matches/:id/noise-hits` | `{ requestId, round }` → `MatchView`；符合噪域条件时扣 1HP |
| GET | `/matches/:id/progress` | 本人已提交回合的 `[{ round, correct, score, answer_text, title }]` |
| GET | `/matches/:id/rounds/:round/hints` | 当前回合已解锁的 `[{ index, content, kind, difficulty }]` |
| POST | `/matches/:id/rounds/:round/hints/:index` | 无请求体要求；`index` 为 0、1、2，返回本题已解锁提示数组 |
| GET | `/matches/:id/result` | 持久化 `MatchResultView`；进行中也可读取，未结束时结果图 URL 为 null |
| POST | `/matches/:id/publication` | `{ published: boolean }` → `{ published }`；控制本人结果是否参榜 |

### 判题、计分与重试

正式前端创建单人局时发送 `X-Artwork-Ready: 1`。服务端先生成最多 10 道开局题目，返回 `awaitingReady: true`；此时只允许读取当前首题图，不计时、不接受答案、提示或伤害。浏览器首题解码后调用 `/matches/:id/ready`，再开始 3 秒倒计时。未发送该请求头的旧客户端保留创建后直接倒计时的兼容行为。

非主线曲绘第一条提示为包含首次收录版本的连续 2～3 个真实版本范围，格式如 `非主线 · v3.4.0–v3.5.0`；已删除时另起一行显示“已删除”。愚人节曲绘的第一条提示内容固定为“愚人节曲目/特殊曲绘”。同曲不同变体分别分类，已解锁提示会持久保存。

`requestId` 是客户端生成的 UUID；猜测的 `answer` 去首尾空白后为 1～200 字符，和 `songId` 必须且只能提供一个。自由文本按 NFKC、去首尾空白、转小写、连续空白归一为单个空格，与开局时曲名/别名快照精确比较，不做模糊匹配。未知自由文本会记为错误作答；不存在或未启用的 `songId` 返回 400。

答题仅接受 `playing`、当前题、`startsAt <= 收到请求时间 < deadline`、本人尚未答对且开启 HP 时仍有血量的状态。错误可继续尝试，正确后该题锁定。`players[].answered` 表示本题已经答对，不表示已经尝试过。

当前规则版本为 `v4-downgrade`。每题满分按开局 EZ/HD/IN/AT 为 500/1000/2000/3000：

- 前 1/6 答题时限无时间扣分，剩余 5/6 按耗时线性扣分，最多扣计分上限的 50%。
- 此前每次错误尝试扣计分上限的 10%，最多扣 50%。时间扣分与错误扣分相加，剩余比例最低为 0，最终四舍五入到整数。
- 只有答对时记分；错误、超时、跳过或未猜出计 0。到截止时刻不再接受答案，计分函数对达到时限的输入也返回 0。
- 前两条提示不降低计分上限；第三条提示为“得分减少，难度下降”，题图降低一档后，按该档的上限计算耗时和错答扣分：HD→EZ 为 500、IN→HD 为 1000、AT→IN 为 2000。题目应得满分、结果中的 difficulty 和综合牌分母仍使用开局难度，例如 AT 降至 IN 后仍以 3000 分为结算基准。提示不延长时限，提示次数仍影响答对回血。

猜测重试须保留原 `requestId` 和原始有效输入。同一用户的同一请求 ID 换比赛、回合或答案返回 409；匹配的重试返回首次 `{ correct, score, elapsedMs }`，不重复记分/扣血。在比赛仍驻留内存时，这也适用于已换题后的重试；该写接口不会主动恢复已被回收的比赛。

`progress` 每题只返回本人的正确记录（优先）或最近一次错误记录；未答对的 `title` 为 null，无猜测的跳过/超时题不出现在此数组。结算完整题目列表请使用 `result`。

### HP、跳题、返回与噪域

开启 HP 时满血开局，上限为 20 或 50；关闭时快照的血量为 0，不执行血量淘汰。所有 HP 变化由服务器保存并广播：

| 事件 | HP 变化 |
|---|---|
| 错答一次 | -1 |
| 超时或跳过，尚未答对 | 再扣 `max(3, 5 - 本题错答次数)` |
| 答对，用提示 0 / 1 / 2 / 3 次 | +5 / +3 / +2 / +1，不超过上限 |
| 有效噪域命中 | -1，不计入错答次数 |

开启 HP 时，血量为 0 的玩家不能继续猜测或解锁提示。多人场并非一人归零就整场结束：全部参赛者归零才立即结束；当前所有玩家均答对或归零时也可结束当前回合。超时/跳过扣血与已发生的错误扣血分别结算。

`skip` 按当前时刻提前结算为超时，更新持久化 deadline；同一题已进入 `reveal` 或 `finished` 后的重复请求不会再次扣血，但换题后重试旧 round 会冲突。`return` 对非 AT 单人比赛把数据库状态设为 `interrupted`，客户端快照结束为 `finished`；AT 活跃场次不退出，返回 `returnBlocked: true` 和首次 `returnBlockedAt`，计时仍继续。已结束单人比赛的 `return` 直接返回快照。房间比赛不能使用这两个单人操作。

`noise-hits` 仅接受仍在 `playing/reveal` 的当前题、开启 HP 且本人存活的参赛者。服务器认可的噪域条件至少满足一个：

- AT 返回限制开启至少 800ms；或
- 当前题本人未答对，时间达到 `startsAt + max(0, duration - 25000) + min(duration, 25000) / 4`，其中 `duration = deadline - startsAt`；或
- 存在本人未答对的已开始过的更早回合。

请求不包含点击坐标，服务器验证阶段与扣血资格，不验证屏幕像素命中。重复相同噪域 `requestId` 不再扣血，返回当时的最新比赛快照；同一 ID 换比赛或回合返回 409。噪域与猜测分别保存幂等记录。

### 提示索引与显示顺序

提示只允许开题后访问当前回合，已结束比赛不允许；新解锁还须处于 `playing`，本人未答对且未耗尽 HP。对有效答题状态重复解锁同一 index 不增加记录。GET/POST 返回数组按数字 index 排序，非降图提示的 `difficulty` 为 null：

| API index | kind | 内容 |
|---|---|---|
| 0 | `range` | 随机连续章节范围，包含本题且不越过已知边界；通常 3～4 章，章节总数不足时缩短；首次写入后固定 |
| 1 | `downgrade` | AT→IN、IN→HD、HD→EZ；选择同歌曲、同版本、同变体的下一档题图，EZ 请求返回 400 |
| 2 | `identity` | EZ/HD：准确章节与曲师；IN/AT：曲师与该曲绘画师 |

前端显示/解锁顺序为 EZ `[0, 2]`，其余难度 `[0, 2, 1]`，所以降图是第三条提示。服务端没有强制按此顺序解锁；API 的 index 不等于界面提示的顺序编号。缺少章节、曲师、画师或下一档素材时相应请求返回 404。

### 时间与快照

首题有 3 秒准备时间，开题前不可读明文题图、猜测或解锁提示。所有人答对/归零、超时或跳过后，若未整体耗尽 HP，进入约 2 秒 `reveal`，然后换题或结束；后续题目没有重复准备倒计时，仍有完整 `roundSeconds`。服务端每 250ms tick 推进状态，操作请求也会触发推进。`reveal/finished` 快照的 `answer` 包含当前题曲名，对所有参赛者可见。

精确类型见 `MatchView`；简化示例：

```json
{
  "id": "比赛 UUID",
  "mode": "practice",
  "status": "playing",
  "difficulty": "hd",
  "round": 0,
  "totalRounds": 5,
  "endless": false,
  "healthEnabled": true,
  "healthCapacity": 20,
  "returnBlocked": false,
  "serverNow": 1791410400000,
  "startsAt": 1791410403000,
  "deadline": 1791410433000,
  "nextAt": 0,
  "imageUrl": "/api/matches/比赛UUID/rounds/0/image",
  "answer": null,
  "players": [{"id":"用户UUID","name":"玩家","score":0,"answered":false,"health":20}],
  "rulesVersion": "v4-downgrade"
}
```

`totalRounds` 在 Infinity 为开局抽取的歌曲数；可选 `imageKey` 为本题预加载密钥。客户端应按 `serverNow` 校正时间差，显示 `startsAt/deadline/nextAt`，以服务器状态判定是否能操作。广播是完整状态快照，不是逐帧倒计时。

进程重启会把遗留数据库 `active` 场次标记为 `interrupted`。完成快照约一小时后回收；GET 快照可从数据库恢复 `finished/interrupted` 场次的最后一题，恢复后的快照统一显示 `finished`，持久化 `result.status` 保留原始状态。不要仅靠快照的 `finished` 判断可参榜。

## 题图与结算图权限

以下全部使用 Bearer；二进制图片与预加载响应返回 `Cache-Control: private, no-store`，`result-reveal` 的 JSON 响应未单独设置此缓存头。普通/结算题图另带限制性 CSP。客户端用鉴权 fetch 读取 Blob，创建 Object URL，使用完毕撤销。

| 方法 | 路径 | 内容与权限 |
|---|---|---|
| GET | `/matches/:id/rounds/:round/image` | 本人当前题开题后可读；按本人已解锁降图提示选图；支持结束恢复后的最后一题 |
| GET | `/matches/:id/rounds/:round/preload` | 活跃场次当前题开题后，仅预取下一题加密数据；拒绝更远题、最后一题之后或已结束场次 |
| GET | `/matches/:id/rounds/:round/original` | 本人该题已经答对时可读 Raw WebP 预览，不限于当前题或已结束场次 |
| GET | `/matches/:id/rounds/:round/result-image` | 仅持久化状态 `finished/interrupted` 的已持久化的回合记录；本人答对且有 Raw 时返回 Raw 预览，否则返回开局难度题图 |
| GET | `/matches/:id/rounds/:round/result-reveal` | 仅 `finished/interrupted` 的参赛者，返回 `{ title, imageUrl }`；允许揭晓本人错题，URL 指向 `result-original` |
| GET | `/matches/:id/rounds/:round/result-original` | 与 `result-reveal` 相同权限，直接返回 Raw WebP 预览 |

`result-image` 的错题图使用该回合原始开局档位，不使用本人降图提示记录。结果揭晓不要求先调用 `result-reveal`，不改变猜测、分数或发布状态；没有 Raw 预览时揭晓返回 404。首题记录在准备倒计时前已创建，因此准备期中断也可能留下可读的结算图；没有已持久化回合记录的未来题不在结果图接口授权范围。公开 showcase 另有公开预览权限，不能把上述限制理解为 Raw 内容全站保密。

预加载响应为 `application/octet-stream`，`X-Artwork-Mime` 表示解密后的 MIME。原素材先 gzip 再 AES-256-GCM 加密，字节布局是 12 字节 nonce、密文、16 字节认证标签。服务器在题目正式开始后才在快照提供 Base64 `imageKey`。前端最多缓存下一张密文，切题后解密、解压，失败回退 `/image`；降图提示也从 `/image` 加载。密文预取不意味着提前取得明文，网络延迟仍会影响实际看图时间。

## 持久化结果、发布与排行榜

`GET /matches/:id/result` 返回本人可见的 `MatchResultView`：

- 场次：`id, mode, difficulty, status, rules_version, created_at, finished_at, health_capacity, round_count, round_seconds, endless, published`。
- `players`：`[{ user_id, name, score, correct, health }]`，按总分降序、用户 ID 排序，包含该场全体参赛者。
- `rounds`：本人每个已持久化回合的 `{ round, title, difficulty, score, correct, attempts, wrongAttempts, hintsUsed, noiseHits, elapsedMs, imageUrl }`。未答对的 `title` 为 null；`difficulty` 为开局题图档位；进行中场次的 `imageUrl` 为 null。错题耗时按本题开始至 deadline/场次结束/当前时间的适用较早时刻计算。

`publication` 只改变本人的 `published` 标记。设为 true 必须满足：数据库状态为 `finished`、单人 `practice`、Infinity（`round_count=0`）、IN/AT、开启 20/50HP、规则为当前 `v4-downgrade`；否则 409。血量归零也可能正常落为 `finished`，无需答完整个曲库才可发布。设为 false 可取消本人的标记，不要求以上参榜条件。发布不会开放结果或题图接口给非参赛者。

排行榜查询为严格对象：

```text
GET /api/leaderboards?difficulty=at&healthCapacity=20&roundSeconds=30
```

`difficulty` 仅 IN/AT，默认 AT；`healthCapacity` 仅 20/50，默认 20；`roundSeconds` 仅 15/30/60，默认 30，AT 必须为 30。旧 `mode`、`rounds` 参数会被拒绝。同难度、同血量上限、同时限下的已发布完成单人 Infinity 成绩显示在同一榜单。旧规则成绩标记 `isLegacy: true`、排名 `rank: "--"`，排在新排名之后；当前规则重新排名。每位玩家优先选当前规则最佳成绩（同分时优先答对数），没有新成绩时保留旧规则最佳记录。公布新规则成绩会取消该玩家同条件旧成绩的榜单公布标记，历史比赛记录不删除。相同新规则分数同名次。

返回最多 100 条 `[{ id, name, avatarUrl, rank, score, correct, totalRounds, isGuest, isReference?, isLegacy? }]`，`rank` 为字符串。`totalRounds` 是该条成绩已创建回合记录的数量。当前实现会合入 `HATE_GEOPELIA` 静态参考角色（`isReference: true`，325 题满分）并重新排名；它不是一次真实比赛或当前曲库数量。

每日挑战及旧每日榜路由不再提供，返回 404；旧数据库表只作历史存档。

## 房间

全部需鉴权；房间码匹配 `[A-Z2-9]{6}`，生成器避开易混淆字母。每位用户最多同时加入一个房间，每个房间最多 8 人。

| 方法 | 路径 | 请求 / 响应与权限 |
|---|---|---|
| POST | `/rooms` | `GameOptions` → `RoomView`，创建者成为房主，默认未准备 |
| POST | `/rooms/:code/join` | → `RoomView`；加入未开局且未满房间，重复加入本房间直接返回快照 |
| GET | `/rooms/:code` | → `RoomView`；仅成员 |
| POST | `/rooms/:code/ready` | `{ ready: boolean }` → `RoomView`；仅未开局成员 |
| POST | `/rooms/:code/options` | `GameOptions` → `RoomView`；仅未开局房主；实际参数改变会清空全员准备状态 |
| POST | `/rooms/:code/start` | → `MatchView`；仅房主，至少两人且包括房主在内所有人准备 |
| POST | `/rooms/:code/leave` | → `{ left: true }`；仅成员，房主离开后移交下一名，空房删除 |

`RoomView` 为 `{ code, hostId, options, matchId, players: [{ id, name, ready }] }`。更新 options 是带默认值的完整选项请求，不能按局部 PATCH 理解；归一化后参数未改变时保留准备状态。开局还会检查是否有人在其他活跃比赛中。

房间一房一场，结束后离开并新建继续。离房不撤销参赛资格、不停止计时、不删除分数；断线不自动踢人，重连仍用原 token。房间只在内存，约 3 小时无发布更新后回收，普通 GET 不延长此期限。

## Socket.IO

连接路径 `/socket.io/`，握手 `auth: { token }`；使用 Socket.IO 客户端，不是原生 WebSocket。HTTP 与 Socket.IO 使用同一个服务入口。客户端先挂载监听再订阅，重连后重新订阅：

| 客户端事件 | 参数 | ack |
|---|---|---|
| `room:subscribe` | `{ code }` | `{ ok: true, data: RoomView }` 或 `{ ok: false, error }` |
| `match:subscribe` | `{ id }` | `{ ok: true, data: MatchView }` 或 `{ ok: false, error }` |

仅成员/参赛者可订阅；每个连接最多订阅一个房间和一场比赛。广播 `room:state`、`match:state` 都是完整快照；写操作统一走 HTTP。离房成员退出该房间广播组，但历史比赛订阅资格不因离房撤销。

首次握手、每次订阅均验证会话；每 30 秒重新验证已建立连接，注销后的广播权限最多延迟约 30 秒收回。单身份最多三个已建立连接，每个连接每分钟最多 60 次订阅操作。若握手带 Origin，必须匹配配置的 `PUBLIC_ORIGIN`。

### 曲绘范围（0.2.1 Preview）

创建练习可传 `artworkScopes` 数组：`main`、`non-main`、`removed`、`april-fools`；省略表示全部。数组必须至少包含 `main` 或 `non-main`。已删除与愚人节分别独立分类，愚人节优先于已删除。AT 始终忽略范围筛选，使用全曲库。
