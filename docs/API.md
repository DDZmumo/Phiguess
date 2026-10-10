# 接口协议 v1

前端位于 `apps/web`。所有 HTTP 路径以 `/api` 开头。成功 GET 为 200，成功 POST 默认 201；错误使用 HTTP 400/401/403/404/409/429/503。比赛时间均为 Unix 毫秒，数据库返回的时间为 ISO 字符串。

## 身份与曲库

| 方法 | 路径 | 输入 / 作用 |
|---|---|---|
| GET | `/health/live` | 进程存活 |
| GET | `/health/ready` | 数据库与迁移可用 |
| POST | `/auth/guest` | `{ "name": "玩家" }` → `{ token, expiresAt, user: { id, name } }` |
| POST | `/auth/logout` | 注销当前会话；需鉴权 |
| GET | `/me` | 当前用户；需鉴权 |
| GET | `/me/active` | `{ match: { id, mode } \| null }`，当前正在进行的挑战 |
| POST | `/me/name` | `{ "name": "新昵称" }`，更改当前游客昵称；需鉴权 |
| POST | `/me/avatar` | Bearer 鉴权 + multipart 字段 `avatar`；返回 `{ avatarUrl }` |
| GET | `/users/:id/avatar` | 读取已上传的 WebP 头像；公开展示资源 |
| GET | `/showcase` | 从 Raw 原图库随机返回最多 12 张背景预览的 `{ id, url }`，不含曲名 |
| GET | `/showcase/:id/image` | 读取公开原图预览；ID 对应每个曲绘变体的代表记录，不允许任意资源 ID |
| GET | `/me/history` | 最近 50 场记录；需鉴权 |
| GET | `/songs?q=别名` | 最多 50 条 `{ id, title, aliases }`；前端搜索选歌后提交歌曲 ID |
| GET | `/leaderboards?mode=practice&difficulty=hd&rounds=5&roundSeconds=30` | 相同模式/难度/题数/时限的个人最佳成绩，最多 100 名 |

需鉴权接口携带 `Authorization: Bearer <token>`。昵称不是唯一账号标识；游客身份暂不支持跨设备找回或密码登录。

用户对象包含可空的 `avatarUrl`。头像只接受单帧 PNG/JPEG/WebP，文件最大 3MiB、解码最大 1600 万像素，服务端自动旋转并居中裁为 256×256 WebP、移除原始元数据。新 URL 带版本参数，替换后不复用旧缓存。上传头像每 IP 每分钟最多 6 次。

## 比赛

| 方法 | 路径 | 输入 / 作用 |
|---|---|---|
| POST | `/matches/practice` | `{ "difficulty": "ez", "rounds": 5, "roundSeconds": 30 }`，字段均有默认值 |
| GET | `/matches/:id` | 获取运行中或近期完成比赛快照，需为参赛者 |
| POST | `/matches/:id/guesses` | `{ "requestId": "UUID", "round": 0, "answer": "歌名或别名" }`；也兼容 `songId`，二者只能传一个 |
| GET | `/matches/:id/rounds/:round/image` | 当前回合题图二进制；开始前、未来回合、非参赛者均拒绝 |
| GET | `/matches/:id/result` | 数据库保存的状态和参赛者分数，需为参赛者 |
| GET | `/matches/:id/progress` | 当前玩家已提交的回合：`round, correct, score, answer_text, title`；仅猜中的 `title` 非空 |
| GET | `/matches/:id/rounds/:round/hints` | 已解锁提示数组 `[{ index, content }]`；未解锁内容不返回 |
| POST | `/matches/:id/rounds/:round/hints/:index` | 解锁提示；index 为 0～2，重复点击幂等，返回已解锁数组 |

回合编号从 0 开始。请求 ID 由客户端生成 UUID；网络超时后重试必须保留原 ID 和原 payload。同一个 ID 换输入会返回 409。

答案响应为 `{ correct, score, elapsedMs }`。截止前可多次猜测；错误作答计 0 分但不锁定输入，正确作答后该玩家本题锁定，后续不再加分。答对基础分按开局 EZ/HD/IN/AT 分别为 1000/1200/1500/1800，另有最多 300 分速度奖励，按整秒分档。规则版本为 `v2-timed`。

自由文本按 NFKC、去首尾空白、转小写、连续空白归一化后，与本题标准曲名/别名精确比较。不做模糊匹配。不存在的曲名也作为一次错误作答记录，不返回曲库候选或题目答案。提示目前不扣分；记录每个玩家的解锁情况，重连可读取。

提示接口只允许当前回合、开题后、参赛者访问；新解锁只接受答题阶段。返回 `{ index, content, kind, difficulty }`，内容直接显示在提示框中：

- index 0：章节范围，显示“第 X 章-第 Y 章”。上下界都计入，范围随机覆盖 3～4 个连续章节，始终包含本题章节，且不越过题库已知的章节边界；解锁后保存该范围。
- index 1：AT→IN、IN→HD、HD→EZ；记录该玩家的低难度素材 ID，后续题图接口返回对应图片，重连可恢复。EZ 请求此项返回 400。
- index 2：EZ、HD 显示准确章节与曲师；IN、AT 只显示曲师与本题曲绘的画师。EZ 的界面把此项放在第二个提示框，其他难度放第三个框。

`progress` 每题只返回该玩家的最终正确记录或最近一次错误记录，不返回未来或未猜中的题名。快照 `players[].answered` 现在表示本题已经猜中；错误尝试仍是 false。

每日挑战及原每日榜接口均返回 404。历史数据库表保留存档，不用于新比赛或新排行榜。

首题保留 3 秒准备倒计时；`startsAt` 之前不能读题图或作答。所有人猜中后短暂停留 450ms，时间到则停留 900ms，随后切换下一题，不再重复倒计时。每题仍拥有完整的 `roundSeconds` 答题时间；状态推进受 250ms 服务端 tick 调度影响。最后一题揭晓完成后落为 `finished`。

前端必须按 `serverNow` 估算时间差，再展示 `startsAt/deadline/nextAt`，不要将客户端倒计时作为裁定依据。快照在状态变化时广播，不逐帧推送；倒计时归零由前端本地显示控制。

快照示例（精确类型见 `packages/contracts/src/index.ts`）：

```json
{
  "id": "比赛 UUID",
  "mode": "room",
  "status": "playing",
  "difficulty": "hd",
  "round": 0,
  "totalRounds": 5,
  "serverNow": 1791410400000,
  "startsAt": 1791410403000,
  "deadline": 1791410433000,
  "nextAt": 0,
  "imageUrl": "/api/matches/比赛UUID/rounds/0/image",
  "answer": null,
  "players": [{"id":"用户UUID","name":"玩家","score":0,"answered":false}],
  "rulesVersion": "v2-timed"
}
```

题图使用 Bearer 鉴权，所以前端应使用 `fetch(imageUrl, { headers: { Authorization: ... } })` 读取 Blob，再创建 Object URL 给 `<img>`；切换题目后撤销旧 Object URL。不要把 token 放进 URL。服务端对题图返回 `private, no-store`，不会公开原始素材路径。

## 房间

全部需鉴权。每个用户同时最多加入一个房间，每个房间最多 8 人。

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/rooms` | 创建，输入与练习参数相同 |
| POST | `/rooms/:code/join` | 加入未开局房间 |
| GET | `/rooms/:code` | 获取房间快照 |
| POST | `/rooms/:code/ready` | `{ "ready": true }` |
| POST | `/rooms/:code/start` | 房主开局；至少两人且所有人准备；返回比赛快照 |
| POST | `/rooms/:code/leave` | 离开；房主离开时移交给下一名成员 |

房间当前一房一场；结束后离开并新建房间继续。退出房间不撤销参赛资格、分数或计时。网络断线不自动踢出玩家；重连使用原 token。未操作的房间约 3 小时后回收。

## Socket.IO

连接路径 `/socket.io/`，握手参数 `auth: { token }`。使用 Socket.IO 客户端，而非原生 WebSocket 客户端。HTTP 和 Socket.IO 使用同一个来源和映射端口。

| 客户端事件 | 参数 | ack |
|---|---|---|
| `room:subscribe` | `{ code }` | `{ ok: true, data: RoomView }` 或 `{ ok:false,error }` |
| `match:subscribe` | `{ id }` | `{ ok: true, data: MatchView }` 或 `{ ok:false,error }` |

服务端广播 `room:state` 和 `match:state`，内容均为完整快照。先挂载事件监听，再订阅；断线重连后重新订阅，使用 ack 中的最新快照恢复。每个连接只订阅一个房间与一场比赛。变更操作统一走 HTTP，避免两套判题与幂等逻辑。

首次连接和每次订阅都会校验会话，已建立连接每 30 秒复核一次；注销后的广播权限最多延迟 30 秒收回。单身份最多三个已建立连接，订阅操作每分钟最多 60 次。


### 结束场次的刷新恢复

参与者刷新已结束的挑战时，服务端可以从保存的场次、回合和答题记录恢复最后一题的快照。
最后一题的已授权难度题图仍可读取；不开放其他回合或其他玩家的题图权限，原图仍要求本人答对。
前端根据恢复的回合时间和答题结果重建曲绘、曲名与提交按钮的噪域状态。


### 血条显示选项

创建练习、创建房间与更新房间选项的 `GameOptions` 可以传入 `healthEnabled`（布尔值，省略时默认开启）。服务端强制 EZ 为关闭、AT 为开启，HD／IN 使用所选值。比赛快照返回归一化的 `healthEnabled`，该值也随结束场次恢复。此选项目前控制视觉显示，不改变现有计分与结束条件。
