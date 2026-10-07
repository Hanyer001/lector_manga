import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { fileURLToPath,pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
const vendor = new URL('src/frontend/vendor/', root), icons = new URL('src/frontend/icons/', root);
await mkdir(vendor, { recursive: true }); await mkdir(icons, { recursive: true });
await copyFile(new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js', root), new URL('supabase.js', vendor));
const require = createRequire(import.meta.url);
for (const name of ['sql-wasm.js','sql-wasm.wasm']) await copyFile(require.resolve('sql.js/dist/'+name),new URL(name,vendor));
await copyFile(new URL('../LICENSE',pathToFileURL(require.resolve('sql.js/dist/sql-wasm.js'))),new URL('sql.js.LICENSE.txt',vendor));
for (const name of ['database-core','metadata','discovery','transfer']) {
  const source=await readFile(new URL('src/storage/'+name+'.js',root),'utf8');
  await writeFile(new URL(name+'.js',vendor),source.replaceAll('../backend/errors.js','./errors.js').replaceAll('../frontend/','../'));
}
await copyFile(new URL('src/backend/errors.js',root),new URL('errors.js',vendor));
const schemas=[];
for(const name of ['schema','library-migration','reader-migration','discovery-migration','privacy-migration'])schemas.push(await readFile(new URL('src/storage/'+name+'.sql',root),'utf8'));
await writeFile(new URL('schema.json',vendor),JSON.stringify(schemas));
// Icono propio dibujado en código. PNG estándar, sin herramientas de imagen externas.
function crc32(bytes) { let n=0xffffffff; for(const byte of bytes){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0; }
function chunk(type, bytes) { const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([name,bytes])));return Buffer.concat([size,name,bytes,crc]); }
for(const size of [192,512]) {
  const pixels=Buffer.alloc(size*(1+size*3));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const px=x/size,py=y/size;
    const frame=px>.24&&px<.76&&py>.24&&py<.76;
    const line=frame&&(px<.28||px>.72||py<.28||py>.72||Math.abs(px-.5)<.018);
    const bookmark=px>.57&&px<.64&&py>.28&&py<.43;
    const color=line||bookmark?[216,178,149]:[8,8,8];
    const at=y*(1+size*3)+1+x*3;pixels.set(color,at);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  await writeFile(new URL(`icon-${size}.png`,icons),png);
}
console.log('Cliente de cuentas e iconos preparados en '+fileURLToPath(new URL('src/frontend/',root)));
