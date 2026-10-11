# 本地素材与别名库

初始完整素材来源为 `E:/Project/PhiguessAs`，历史导入流程复制源文件并校验 SHA-256，不修改原目录。完整本地源库、Git 跟踪的可运行子集、导入后生成的运行图片是不同口径。

以下数量是本次仓库快照的复核值，不是永久不变的曲库限制。新增歌曲、变体或同步别名后应重新统计，不要只手动替换一个数字。

## 已登记资源与统计口径

| 内容 | 当前快照 / 口径 |
|---|---:|
| 初始完整源库 | 300 PNG：Raw 与四档各 60；不是当前克隆包含的全部文件 |
| 源无损 WebP | 120：Raw 60 + EZ 60；对应 PNG 已校验后删除 |
| 独立歌曲 | 57 个 `songId` |
| 四档曲绘套组 | 60 个歌曲/变体组，60 份 manifest |
| Git 跟踪的 HD / IN / AT | 各 60 SVG，共 180 |
| 成功导入后的运行题图 | EZ 60 WebP；HD / IN / AT 各 60 SVG |
| 名称/别名按曲绘组累计 | 498：60 个 group/manifest 的 aliases 长度之和，多变体会重复计算 |
| 名称/别名按歌曲合并 | 453：按 57 个 `songId` 合并后，逐歌精确去重再相加 |

498 和 453 都来自当前数据，不能把两者当成新旧版本差异。《What do you want more than a Happy ending?》的四套曲绘 `illustration-ez/hd/in/at` 共用同一歌曲 ID 和 15 个名称，逐变体累加恰好多算 45 条。抽题按歌曲去重，同局不会因为四套曲绘而重复出现同一首歌。

上述 aliases 数量包含标准曲名和文件名兼容写法，使用原字符串精确去重；判题另做 NFKC、首尾空白、大小写与连续空白归一化，所以不是“互不相同的规范化答案”数量。当前全局原字符串去重为 453，按判题归一化后为 451。实际数据库可能已运行 `aliases:sync` 或被管理员更新，不能只凭静态文件断言线上数量。

可在仓库根目录复算主要口径（Python 3，无额外依赖）：

```powershell
python -c "import json; g=json.load(open('storage/corpus/catalog.json',encoding='utf-8'))['groups']; print({'variants':len(g),'songs':len({x['songId'] for x in g}),'aliasesByVariant':sum(len(x['aliases']) for x in g),'aliasesBySong':len({(x['songId'],a) for x in g for a in x['aliases']})})"
```

## 目录与 Git 边界

```text
storage/corpus/source/          克隆包含 Raw/EZ 无损 WebP；完整本地加工库可另含 HD/IN/AT PNG
storage/corpus/prepared/        每组 manifest + HD/IN/AT SVG；本地重建时另有加工缓存
storage/corpus/catalog.json     60 套曲绘与标准曲目的对应关系
storage/corpus/trace-report.json 历史描摹参数与生成阶段统计
storage/corpus/inventory.json   本地准备流程生成的原路径、大小、SHA-256、匹配情况
storage/corpus/upstream-commit.json 本地准备流程需要的上游提交来源，不随 Git 分发
storage/corpus/import-report.json 本地数据库导入结果
storage/corpus/verification.json 历史独立校验产物，克隆未必包含
storage/assets/                导入后实际运行图片，使用不含歌名的随机文件名
storage/avatars/               用户上传头像的规范化 WebP
data/catalog/songs.json        本地歌曲 UUID 与上游歌曲 ID 的对应关系
data/catalog/aliases.local.json 本地手工增加的别名
data/providers/phi-plugin/     社区曲名/别名快照、原许可与来源记录
```

manifest 的 EZ 路径指向 `source/<章节>/EZ/*.webp`，并非 prepared 下现成的 WebP；Raw 路径指向 `source/Raw/`。当前全部 60 份 manifest 的四档及 Raw 引用均可在克隆中解析。导入器把 EZ 转成 WebP，验证 SVG，并为 Raw 生成运行归档和 WebP 预览。

Git 保留 catalog、trace-report、prepared 的 manifest/SVG、Raw 无损 WebP 和任意章节深度的 EZ 无损 WebP（包括 `Part1/EZ` 等）。`.gitignore` 的目录放行规则允许新增这些素材，同时继续忽略 HD/IN/AT 源 PNG、加工 PNG、其他缓存、运行资源、数据库、头像和测试目录。既有已跟踪文件不受 ignore 规则追溯移除。

直接运行 `npm run preview:game` 使用已跟踪素材导入本地曲库，不需要原 Windows 目录、Python 描摹环境或 `upstream-commit.json`。全量重新描摹则需要完整原始源库；不要把当前只有 Raw/EZ 的克隆目录当成完整 300 PNG 输入。

## 去杂色、SVG 与重建

历史描摹只处理 HD/IN/AT 衍生版本：最长边 1280 → 3×3 中值过滤孤立噪点 → 最大覆盖法生成 64 色调色板、3 次颜色细化 → VTracer 彩色路径描摹。HD/IN/AT 的描摹源 PNG 保持不变；Raw/EZ 转为无损 WebP。最大覆盖法用于保留面积小但有意义的主色，避免单纯频率优先量化吞掉细节。

参数为 RGB 精度 8 bit、相近层差 1、细碎区域过滤 10、轮廓拟合最多 3 轮、路径坐标 1 位小数，不是把位图嵌入 SVG。导入时全部 SVG 须通过 `tools/svg.ts` 的静态子集校验。

当前 180 个已跟踪 SVG 重新按文件统计共 14,240,018 字节，以 gzip level 9 逐文件压缩合计 4,982,377 字节，单文件最大 466,555 字节，最多 530 条路径。此统计不含 EZ/Raw；`trace-report.json` 保存的是旧生成阶段的数值，与当前文件字节不完全相同。对照图 `output/assets/trace-*.png` 为本地历史产物，不随克隆提供。

完整重建前需具备：

1. 完整原始素材目录，包含 Raw 与四档 PNG。
2. `data/providers/phi-plugin/` 的 `info.csv`、`nicklist.yaml`、`LICENSE` 与它们对应的上游提交。
3. 本地 `storage/corpus/upstream-commit.json`，结构为 `{"sha":"40位提交号"}`。`prepare-catalog.mjs` 会读取它，但不会自动创建；缺少时脚本会在准备流程后段失败，不应把原命令当作无前置条件的一键重建。

若使用仓库自带、未修改的初始快照，可先按 provenance 核验哈希并生成这份本地来源文件，再重建（PowerShell）：

```powershell
$provider = 'data/providers/phi-plugin'
$provenance = Get-Content "$provider/provenance.json" -Raw | ConvertFrom-Json
foreach ($entry in $provenance.files.PSObject.Properties) {
  $actual = (Get-FileHash "$provider/$($entry.Name)" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.Value.sha256) { throw "上游快照已变化，先核实对应提交：$($entry.Name)" }
}
New-Item -ItemType Directory -Force storage/corpus | Out-Null
@{ sha = $provenance.commit } | ConvertTo-Json | Set-Content -Encoding utf8 storage/corpus/upstream-commit.json
python -m venv .venv-assets
.\.venv-assets\Scripts\python.exe -m pip install -r tools/asset-requirements.txt
node tools/prepare-catalog.mjs E:\Project\PhiguessAs
.\.venv-assets\Scripts\python.exe tools/trace-catalog.py --workers 2
npm.cmd run assets:catalog
```

使用其他来源时必须记录其真实对应提交，不可套用旧 provenance。`assets:catalog` 使用 `.env` 的目标数据库，运行前确认目标；自动预览改用自己的本地配置。重复预览会跳过已发布的完整四档版本，不覆盖后续更新的别名或提示。重新发布不同素材时应修改 manifest 版本标识，避免覆盖已发布题目。

## 社区别名

来源为 [Catrong/phi-plugin](https://github.com/Catrong/phi-plugin) 的 `resources/info/info.csv` 和 `nicklist.yaml`，初始快照提交为 `d3e36b180273cb9bf856d8b72f5d525ae30913db`。原许可文件与哈希保留在 `data/providers/phi-plugin/`。

判题只访问本地数据库，玩家输入与身份不会发往上游。按需同步：

```powershell
npm.cmd run aliases:sync
```

若目标是当前 `preview:game` 的本地数据库：

```powershell
npm.cmd run build:server
node --env-file=storage/preview/runtime.env dist/tools/sync-aliases.js
```

同步器读取上游默认分支的最新提交，再以该固定提交下载 nicklist；本地补充位于 `data/catalog/aliases.local.json`，例如 `{"Glaciaxion.SunsetRay":["你自己的别名"]}`。它按歌曲将标准曲名、源文件名、社区别名和本地补充去首尾空白后精确去重，过滤空值及超过 200 字符的值，写入数据库，并把快照和 `sync.json` 保存至 `data/providers/phi-plugin/snapshots/<commit>/`。`sync.json.aliasCount` 是按歌曲统计的同步结果，不是 60 份 manifest 的累计数；同步不会自动改写 catalog 或 prepared manifests。

已开局的比赛继续使用内存中的开局答案/别名快照，新比赛使用更新后的数据库数据。

## 提示与 Raw

提示由结构化元数据与曲绘版本生成：`chapter` / `chapterName` 提供章节，`composer` 提供曲师，曲绘 `illustrator` 提供画师。界面按范围、身份、降图排列：EZ 仅前两项，HD/IN/AT 的第三项选取同版本、同变体的下一档题图。服务端 index 分别是 0、2、1；旧 `hints` 文案字段保留兼容，不控制当前提示内容。

Raw 源目录仅保留无损 WebP，导入后按原参数生成缩小的有损 WebP 归档与预览。公开背景使用预览，启动页与账号资料面板随机更换；本人答对后的 `/original` 和结束/中断后的结果揭晓也返回预览。具体参赛者与回合权限见 [API.md](API.md)，不能把公开背景资源称为完全保密的原图。
