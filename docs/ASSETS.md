# 本地素材与别名库

来源目录：`E:/Project/PhiguessAs`。原目录未修改；项目副本逐文件校验 SHA-256。

## 已登记资源

| 内容 | 数量 |
|---|---:|
| 原始文件副本 | 300 PNG |
| 歌曲 | 57 |
| 四档曲绘套组 | 60 |
| EZ 运行题图 | 60 WebP |
| HD / IN / AT 运行题图 | 各 60 SVG |
| Raw 原图 | 60 PNG 原件及对应运行归档 |
| 已登记可接受名称/别名条目 | 453，含标准曲名与文件名兼容写法 |

《What do you want more than a Happy ending?》的四套曲绘分别保留为 `illustration-ez/hd/in/at`，共享同一个歌曲 ID。抽题按歌曲去重，不会同局出现多次。

## 目录

```text
storage/corpus/source/       300 个源文件的完整副本，保留 Raw 与章节目录
storage/corpus/prepared/     去杂色 PNG、SVG、描摹参数与每组 manifest
storage/corpus/catalog.json  60 套曲绘与标准曲目的对应关系
storage/corpus/inventory.json 原路径、大小、SHA-256、匹配情况
storage/corpus/trace-report.json 描摹结果与体积
storage/corpus/import-report.json 数据库导入结果
storage/corpus/verification.json 源副本与运行资源独立校验
storage/assets/             实际运行图片，使用不含歌名的随机文件名
storage/avatars/            用户上传头像的规范化 WebP
data/catalog/songs.json     本地歌曲 UUID 与上游歌曲 ID 的对应关系
data/catalog/aliases.local.json 本地手工增加的别名
data/providers/phi-plugin/  社区曲名/别名快照、原许可与版本来源
```

仓库会跟踪 `storage/corpus/catalog.json`、`storage/corpus/prepared/` 和 `storage/corpus/source/Raw/`：分别保存曲库索引、EZ/HD/IN/AT 四档曲绘与导入清单，以及答对后揭晓所需的 60 张原图。运行时生成的 `storage/assets/`、数据库、玩家头像、测试目录和其余加工缓存仍被 Git 忽略；克隆后运行预览会根据上述素材重建运行资源。

## 去杂色与 SVG 参数

只处理 HD/IN/AT 的衍生版本；原图与用户提供的四档 PNG 副本保持不变。流程：最长边 1280 → 3×3 中值过滤孤立噪点 → 最大覆盖法生成 64 色调色板、3 次颜色细化 → VTracer 彩色路径描摹。

采用最大覆盖法是为了保留面积小但有意义的主色。样本中原先的频率优先量化将粉色误并入紫色，已通过颜色取样发现并修正。

最终参数：RGB 精度 8 bit、相近层差 1、细碎区域过滤 10、轮廓拟合最多 3 轮、路径坐标 1 位小数。不是把位图嵌入 SVG。全部 180 SVG 已通过项目静态 SVG 校验。

最终 SVG 共 14,254,734 字节，gzip 合计 4,983,196 字节；单文件最大 467,059 字节，最多 530 条路径。对照图位于 `output/assets/trace-*.png`，左为源 PNG，右为 SVG 栅格预览。体积统计不包含 EZ 和 Raw。

重建命令（Windows 本地）：

```powershell
python -m venv .venv-assets
.\.venv-assets\Scripts\python.exe -m pip install -r tools/asset-requirements.txt
node tools/prepare-catalog.mjs E:\Project\PhiguessAs
.\.venv-assets\Scripts\python.exe tools/trace-catalog.py --workers 2
npm.cmd run assets:catalog
```

`assets:catalog` 使用 `.env` 中的目标数据库。自动预览会改用自己的本地运行配置并导入；重复启动跳过已经发布的版本，不覆盖后来更新的别名或提示。改变描摹参数并准备重新发布时，应修改 manifest 的版本标识，避免覆盖已发布题目。

## 社区别名

来源：[Catrong/phi-plugin](https://github.com/Catrong/phi-plugin) 的 `resources/info/info.csv` 和 `nicklist.yaml`，初始快照为 `d3e36b180273cb9bf856d8b72f5d525ae30913db`。这是社区数据，原许可文件保留在快照目录。

判题只访问本地数据库，玩家输入与身份不会发往上游。按需更新：

```powershell
npm.cmd run aliases:sync
```

若要更新当前 `preview:game` 的本地数据库：

```powershell
npm.cmd run build:server
node --env-file=storage/preview/runtime.env dist/tools/sync-aliases.js
```

本地补充写在 `data/catalog/aliases.local.json`，例如 `{"Glaciaxion.SunsetRay":["你自己的别名"]}`。同步与本地补充一起入库，并保存上游提交号与哈希。已开局的比赛继续使用开局时的答案/别名快照，新比赛使用更新后的数据。

提示由结构化元数据与曲绘版本生成：`chapter` / `chapterName` 决定范围和准确章节，`composer` 提供曲师；第二项会选取同版本、同变体的下一级难度题图。EZ 没有下一级，界面只有两个提示。旧 `hints` 文案字段仅保留兼容，不再控制新版提示。

Raw 作为独立原图保存，并生成公开背景预览，用于启动页和账号资料面板。两处背景每次刷新随机更换，不再使用 EZ 或视频截帧。
