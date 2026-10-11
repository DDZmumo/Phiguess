# Raw / EZ 无损 WebP

Raw 就是原图，EZ 是题图。本次转换只处理这两类曲绘 PNG：Raw 60 张、EZ 60 张；HD/IN/AT 的运行 SVG 和本地描摹 PNG 保持原样。Raw/EZ 源目录只保留无损 WebP；删除前已核对全部 PNG/WebP 像素及哈希，历史 PNG 哈希留在转换报告中。favicon、角色图标和描摹中间文件不在转换范围内。

| 类别 | 数量 | PNG 字节 | WebP 字节 |
|---|---:|---:|---:|
| Raw 原图 | 60 | 135,044,167 | 90,332,836 |
| EZ 题图 | 60 | 118,722,847 | 84,055,834 |
| 合计 | 120 | 253,767,014 | 174,388,670 |

相对这些源 PNG，无损 WebP 源文件减少 79,378,344 字节（31.2800%）。运行资源继续使用原有缩小、有损方案；此统计属于源素材，不能当作运行图片的传输大小。

编码使用仓库已有 sharp，设置 `lossless: true, effort: 6, exact: true`，保留透明像素下的 RGB。转换不旋转、不缩放、不调整调色板。120 对图片均已对解码 RGBA、宽高逐像素比较，PNG SHA-256 也与历史 inventory 一致。逐文件大小、PNG/WebP SHA-256、解码 RGBA SHA-256 和尺寸见 `storage/corpus/lossless-webp-report.json`。

```powershell
# 离线生成缺失 WebP，核对像素后移除 Raw/EZ PNG，并更新曲库引用；不连接数据库。
npm.cmd run assets:lossless
# 只复核现有 WebP、catalog 和 manifest，不写文件。
npm.cmd run assets:lossless -- --verify-only
```

工具只处理 catalog 的 `original` 和 `assets.ez`，拒绝覆盖像素不一致的既有 WebP。PNG 存在时逐像素验证；仅有 WebP 时按已有转换报告验证文件哈希、尺寸与 RGBA 哈希，不再依赖 PNG。全部图片通过并更新引用后，移除 Raw/EZ PNG。`prepare-catalog.mjs` 会调用同一转换工具，后续 `trace-catalog.py` 生成 `clean64-v2-lossless-{variant}` manifest；HD/IN/AT 继续使用现有 SVG 流程。

导入器本来就接受 WebP，现在通过 manifest 读取新的无损 WebP 源素材。运行压缩与尺寸策略保持原样：

| 运行资源 | 缩小范围（fit: inside，不放大） | 有损 WebP quality |
|---|---|---:|
| EZ 题图 | 1600×1600 | 88 |
| EZ 预览 | 960×660 | 72 |
| 原图归档 | 1920×1920 | 92 |
| 原图预览 | 1280×880 | 80 |

题图和原图归档继续先按源方向旋转，再缩小编码；预览从其运行归档生成。运行资源不保证与源图逐像素相同。无损与逐像素校验针对源素材转换；source 中仅保留转换后的 WebP。

正式答对后的 `/original`、结束/中断后的 `/result-original`、答对回合的 `/result-image` 和公开背景继续读取 `original_preview_key`，保持原有预览选择策略。未答对的结果题图仍使用原来的题图 `storage_key`。

60 份 manifest 已改用 WebP 源路径和 `clean64-v2-lossless-{variant}` 新版本；版本名中的 lossless 表示源素材。没有运行生产/现有数据库导入，也没有更改现有资产文件或已发布记录。随后导入新版本会读取这些无损源文件，再应用原有运行缩小、有损参数。已有导入事务保留旧版本，进行中的挑战仍引用其原资产。

本地验证包括服务器 TypeScript 构建、全库两轮源文件 RGBA 校验，以及导入定向测试：无损 WebP 源保留 PNG 像素；运行输出遵守原有四类缩小、有损参数；旧运行资源保留，版本不可覆盖。真实 PostgreSQL 集成测试的现有练习用例也增加了三类揭晓使用原图预览键的断言。
