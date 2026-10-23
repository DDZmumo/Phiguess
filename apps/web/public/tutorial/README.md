# Tutorial artwork

The four demonstration songs are Desultory Signals (DS), Exoplanetary Mirage (米垃圾), Entrance to the Chaos (超市入口), and ハテ (8000). EZ and original assets remain local. HD/IN/AT are generated from the same EZ base by /api/tutorial-art/:slug/:difficulty with a fixed lesson seed. No live match or user data is included.

Titles, aliases and hints come from storage/corpus/catalog.json. Second-song training explicitly accepts 米垃圾 as an alias for Exoplanetary Mirage.

Browser originals use lossless WebP at the unchanged 2048×1080 resolution. Decoded pixels are verified against the source PNG files, which remain available. Run `node tools/prepare-tutorial-originals.mjs` to regenerate the four WebP files.

## Copied files

- 8000-ez.png: f622ed8c46043a178b28bfd3aa947758d29c3959430e90aa20da61dbe90bf6d9
- 8000-original.png: bff39d87fd29d93e64a4cec50f469ecad470dc982eca6f171e3010aca9628f6a
- 8000-original.webp: 062ececaea654ebc663a38067bdd33677ffe7604a2f2386eee5859ca38c36e12
- chaos-ez.png: f73cc19bd13aea4078f8027b90daad6f21e4fcfc35d4c05571b6ed659a54fec7
- chaos-original.png: 0173c4b3d1fc0a04acbb579f2e46b835704b2bdc4c1bd9981bd9b311722fb8e3
- chaos-original.webp: 6a063474a4b38d806af32cfbec1caa3bb8912b8a5c6ea319ca82c886a760047b
- ds-ez.png: 73b3e74939d17efe27135910ec5ccad9be340e2db633e200780a4e38724daf62
- ds-original.png: 73b3e74939d17efe27135910ec5ccad9be340e2db633e200780a4e38724daf62
- ds-original.webp: 2343a31c3c3ffb1d48ae8bc808c6816dd8fe3022009a9cd8dc6d2143a00573e7
- mirage-ez.png: f84032279096c50d7e5cd4c0f28db1ec19c06b2b2e9961a7aef41b5f9104a9a7
- mirage-original.png: 6be85d11cb14c1385493f019933192f932ed1aebf03bfb986c3cc15e6cc46066
- mirage-original.webp: 66261c66f1388ed506290dbd14dbd6fdf78c6b79f83348cf8217f9e1e9157f79
