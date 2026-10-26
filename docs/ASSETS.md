# 本地素材与别名库

曲库现只保存 Raw 原图与 EZ 基础图。HD/IN/AT 已接入 [实时题图系统](DYNAMIC-ARTWORK.md)，不再需要预制高难度 PNG 或 SVG。

| 内容 | 数量 |
|---|---:|
| Raw / EZ 无损 WebP | Raw 351，EZ 351，共 702 |
| 独立可玩歌曲 | 339 |
| 可玩歌曲 / 曲绘变体套组 | 351 |
| 导入清单 | 351，仅引用 original 和 assets.ez |
| 待补曲绘 | 0 |

同曲的不同曲绘仍共用歌曲 ID，抽题按歌曲去重。原图与 EZ 源文件保留章节和第九章 Part1/Part2 目录；`prepared/<songId>/<variant>/manifest.json` 仅是清单。原 PNG 的校验信息保存在 `lossless-webp-report.json`。

非主线补充源图 291 张：254 张通过内置图像模型去除曲名/作者后作为 EZ，35 张无相关文字，逐字节复用 Raw；`Break Over` 与 `MARENOL` 已使用用户提供的去字成图补齐 EZ，全部 291 张已入库。模型输出转无损 WebP 的解码像素逐张核对一致，来源及哈希见 `non-main-import-source.json` 和 `non-main-excluded.json`。

## 目录

```text
storage/corpus/source/             Raw/EZ 无损源图，按章节分类
storage/corpus/prepared/           仅有导入清单
storage/assets/                    导入后的原图、EZ、预览和无损 EZ 基础图
storage/generated/                 实时生成的 SVG 缓存，可按持久配方重建
storage/corpus/catalog.json        曲绘和歌曲对应关系
storage/corpus/lossless-webp-report.json  源图像素与文件哈希记录
```

## 导入与准备

EZ 的显示版本仍按最长边 1600、质量 88 编码为 WebP，预览沿用 960×660、质量 72；原图沿用最长边 1920、质量 92，预览 1280×880、质量 80。另保留 EZ 输入的原始字节作为算法基础，避免多次有损压缩改变已确认的抽象效果。

导入器为四档保留元数据，但高难度没有静态 `storage_key`，通过 `source_artwork_id` 关联 EZ。旧清单中的 hd/in/at 字段仅兼容读取，文件不会被导入。所有正式资源仍通过鉴权接口发送，猜题前不暴露未来题图。

```powershell
npm.cmd run assets:lossless -- --verify-only
node tools/prepare-manifests.mjs
npm.cmd run assets:catalog
```

从外部完整目录重新整理时运行 `node tools/prepare-catalog.mjs E:\Project\PhiguessAs`，仅收集 Raw/EZ，自动准备无损来源和清单，不再描摹 HD/IN/AT。仍需准备社区元数据和 `storage/corpus/upstream-commit.json` 的真实上游提交。普通本地预览直接使用仓库内的 catalog 和清单，不需要外部目录。

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

非主线导入清单设 `contentKind: "non-main"`、`introducedVersion`（如 `"3.4.0"`）及可选 `removed: true`。第一条提示显示“非主线”与包含首次收录版本的连续 2～3 个真实版本范围；已删除曲目追加“已删除”。范围首次揭示后持久保存，重复请求不会改变。`contentKind: "april-fools"` 的第一条提示只显示“愚人节曲目/特殊曲绘”。普通歌曲仅拥有愚人节谱面时仍按普通曲目处理，特殊曲绘变体单独分类。非主线 EZ/HD 的身份提示只显示曲师，不显示主线章节。

分类和版本保存在每个曲绘版本上；同曲的主线原版、非主线或愚人节变体不会互相覆盖提示规则。特殊曲绘没有可靠画师记录时，显示“画师：未收录”。

批量收集结果可由 `node tools/prepare-non-main-catalog.mjs --source=<素材目录>` 检查进度；加 `--apply` 前要求全部图片处理完成。工具校验 Raw/EZ 哈希、无文字图逐字节复用、模型输出转 WebP 后逐像素一致，再复制进 `source/Raw/Non-main/` 和对应 EZ 目录，生成导入清单。原 PNG 下载文件不进入最终素材目录，来源仓库、提交、文件及去字方式记入曲库索引。

Raw 源目录仅保留无损 WebP，导入后按原参数生成缩小的有损 WebP 归档与预览。公开背景使用预览，启动页与账号资料面板随机更换；本人答对后的 `/original` 和结束/中断后的结果揭晓也返回预览。具体参赛者与回合权限见 [API.md](API.md)，不能把公开背景资源称为完全保密的原图。
