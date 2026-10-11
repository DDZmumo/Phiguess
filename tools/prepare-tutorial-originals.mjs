import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';

// Keep the source PNGs; only the browser's teaching previews use WebP.
for(const song of ['ds','mirage','chaos','8000']){
 const source=`apps/web/public/tutorial/${song}-original.png`,target=source.replace('.png','.webp');
 const png=await readFile(source),webp=await sharp(png).webp({lossless:true,effort:6}).toBuffer();
 await writeFile(target,webp);
 console.log(`${song}: ${png.length} -> ${webp.length} bytes`);
}
