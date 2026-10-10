# Game UI fonts

Latin text uses the Saira family distributed by `@fontsource/saira` under SIL OFL 1.1, authored by Omnibus-Type: https://github.com/Omnibus-Type/Saira .

`phiguess-cjk.woff2` is a glyph subset of Adobe Source Han Sans SC Regular, renamed **Phiguess CJK** to respect the reserved font name. Original source: https://github.com/adobe-fonts/source-han-sans/tree/release/OTF/SimplifiedChinese . The original license is retained in `SOURCE-HAN-LICENSE.txt`.

Build the subset with `tools/subset-game-font.py` using FontTools and Brotli. Missing user-supplied glyphs fall back to the operating system's Chinese font. The complete upstream OTF is kept only in ignored local `storage/fonts`.

`phiguess-difficulty-hanzi.woff2` is the current story-animation font: a renamed subset of Source Han Sans SC Heavy containing the 270 distinct Hanzi in `apps/web/src/difficulty-characters.json`, including 外挂、龙比、人类、区区. Its current size is 85,372 bytes. Rebuild with `tools/subset-difficulty-font.py` under the same included SIL OFL license. The earlier seven-glyph `phiguess-difficulty.woff2` is retained as a historical resource and is no longer loaded by the difficulty screen.
