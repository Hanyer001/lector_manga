import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './prepare-client.js';
const root = new URL('../', import.meta.url), output = new URL('dist/pages/', root);
function publicOrigin(value, name) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error(`${name} debe ser un origen HTTPS sin ruta ni credenciales.`);
  return url.origin;
}
const key=process.env.SUPABASE_PUBLIC_KEY;
if(!key||key.startsWith('sb_secret_'))throw new Error('Configura SUPABASE_PUBLIC_KEY con la clave publicable de Supabase.');
try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='service_role')throw new Error('La clave service_role nunca puede publicarse.');}catch(error){if(error.message.includes('service_role'))throw error;}
const config={mode:'cloud',apiBase:publicOrigin(process.env.PUBLIC_API_ORIGIN,'PUBLIC_API_ORIGIN'),supabaseUrl:publicOrigin(process.env.SUPABASE_URL,'SUPABASE_URL'),supabasePublicKey:key,privateEncryption:'e2ee',privateSync:'supabase'};
await mkdir(output,{recursive:true});
await cp(new URL('src/frontend/',root),output,{recursive:true});
await writeFile(new URL('config.js',output),'window.LECTOR_CONFIG = '+JSON.stringify(config).replaceAll('<','\\u003c')+';\n');
await writeFile(new URL('.nojekyll',output),'');
// Cambia la caché de interfaz al publicar una nueva versión; nunca se cachean datos personales.
const {createHash}=await import('node:crypto');
const files=(await readdir(output)).filter(name=>/\.(js|css|html)$/.test(name)).sort();
const hash=createHash('sha256');
for(const name of files)hash.update(name).update(await readFile(new URL(name,output)));
const fingerprint=hash.digest('hex').slice(0,12);
// Una publicación debe cargar módulos de la misma versión, aunque el navegador
// o el CDN aún conserven archivos de la publicación anterior.
for(const name of files.filter(name=>name!=='sw.js'&&/\.(js|html)$/.test(name))){
  const code=await readFile(new URL(name,output),'utf8');
  await writeFile(new URL(name,output),code.replace(/(['"])(\.\/[^'"?]+\.(?:js|css))\1/g,(_match,quote,path)=>path==='./sw.js'?quote+path+quote:quote+path+'?v='+fingerprint+quote));
}
const worker=await readFile(new URL('sw.js',output),'utf8');
await writeFile(new URL('sw.js',output),worker.replace('lector-shell-v1','lector-shell-'+fingerprint));
console.log('GitHub Pages preparado en '+fileURLToPath(output));
