import {execFileSync} from 'node:child_process';

// Only application/effect/identity icons are versioned. Song media is provisioned separately.
const allowed=new Set([
 'apps/web/public/favicon.png','apps/web/public/mark.svg','apps/web/public/reference/avatar.webp',
 'apps/web/public/characters/hate-geopelia.png','apps/web/public/effects/noise-domain/contact-atlas.webp',
 'apps/web/public/effects/noise-domain/hl-noise-60.mp4',
]);
const media=/\.(?:png|jpe?g|webp|avif|gif|svg|bmp|tiff?|mp4|webm|apk|bundle|unity3d|zip|tgz)$/i;
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let paths=tracked;
if(process.argv.includes('--history'))paths.push(...execFileSync('git',['-c','core.quotepath=false','log','HEAD','--format=','--name-only','-z'],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').map(path=>path.replace(/^\n+/,'')));
const rejected=[...new Set(paths.filter(path=>media.test(path)&&!allowed.has(path)))];
if(rejected.length){console.error(`Private media found in Git (${rejected.length} paths):\n${rejected.slice(0,20).join('\n')}`);process.exit(1);}
const samples=['storage/corpus/source/Raw/example.webp','storage/corpus/source/01 Example/EZ/example.png','storage/corpus/prepared/id/default/artwork.svg','apps/web/public/library/covers/AllSong.webp','apps/web/public/tutorial/ds-original.webp','apps/web/public/reference/title-art.webp'];
for(const path of samples){try{execFileSync('git',['check-ignore','--no-index',path],{stdio:'pipe'});}catch{throw Error(`Private-media ignore rule missing for ${path}`);}}
console.log(`Private media audit passed${process.argv.includes('--history')?' for HEAD history':''}; UI icons retained.`);
