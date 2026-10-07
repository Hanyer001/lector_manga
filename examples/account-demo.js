// Prueba aislada de interfaz. Datos inventados, cuentas ficticias, solo 127.0.0.1.
// La aplicación de Render siempre usa src/backend/server.js y Supabase real.
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { createImageTickets } from '../src/backend/imageTickets.js';
import { memoryAccountStore, USERS } from '../test/helpers/account-store.js';
import {memorySupabase} from '../test/helpers/supabase-vault.js';

export async function startAccountDemo({apiPort=3213,webPort=3214,alternatives=false}={}) {
  const state=memoryAccountStore(),tickets=createImageTickets(),faults={images:false,progress:false};
  const apiServer=createServer(),webServer=createServer();
  apiServer.listen(apiPort,'127.0.0.1');webServer.listen(webPort,'127.0.0.1');
  await Promise.all([once(apiServer,'listening'),once(webServer,'listening')]);
  const api=`http://127.0.0.1:${apiServer.address().port}`,web=`http://127.0.0.1:${webServer.address().port}`;
  const png=await readFile(new URL('../src/frontend/icons/icon-512.png',import.meta.url));
  const source={id:'qa-local',name:'Fuente de prueba',enabled:true,demo:false,pageOrigin:api,imageOrigins:[api],capabilities:{search:true,manga:true,chapters:true,images:true,recommend:true},userAgent:'ReaderAccountQA/1',scraper:{
    async getManga(url){return {manga:{title:'Historia de prueba',url,cover:api+'/qa/image.png',genres:['Action','Fantasy'],authors:['Autora de prueba'],description:'Una aventura de fantasía para las pruebas del lector.',status:'ongoing',country:'KR'}};},
    async getChapters(url){return {manga:{title:'Historia de prueba',url},chapters:[1,2,3].map(number=>({title:'Capítulo '+number,number,url:api+'/qa/chapter/'+number}))};},
    async getChapterImages(url){return {chapter:{title:'Capítulo '+url.split('/').at(-1),url},images:Array.from({length:6},(_,index)=>({index,url:api+'/qa/image.png?n='+index,referer:url}))};},
    async recommend({page=0}={}){return {source:'qa-local',results:Array.from({length:36},(_,index)=>{const id=page*36+index;return {source:'qa-local',title:'Recomendación '+id,url:api+'/qa/recommend/'+id,cover:api+'/qa/image.png?cover='+id,genres:['Action','Fantasy'],country:'KR'};}),nextPage:page<1?page+1:null};},
    async search(){return {source:'qa-local',results:[{source:'qa-local',title:'Historia de prueba',url:api+'/qa/manga',cover:api+'/qa/image.png'}],nextPage:null};}
  }};
  const db=openDatabase(':memory:');
  const series=db.saveFavorite({source:source.id,titulo:'Historia de prueba',url_origen:api+'/qa/manga',portada:api+'/qa/image.png',metadata:{genres:['Action','Fantasy'],country:'KR'}});
  const folder=db.saveFolder('Favoritos');db.updateLibrary(series.id,{folder_ids:[folder.id],reading_state:'reading'});
  const chapters=db.saveChapters(series.id,(await source.scraper.getChapters(series.url_origen)).chapters);
  db.markChapterRead(chapters[0].id);db.updateProgress({serie_id:series.id,capitulo_id:chapters[1].id,scroll_position_y:0,page_index:1,page_fraction:.4});
  state.states.set(USERS.a.id,{revision:1,state:db.exportState()});db.close();
  const sources=new Map([[source.id,source]]);
  if(alternatives)sources.set('qa-alt',{...source,id:'qa-alt',name:'Otra fuente de prueba',scraper:{...source.scraper,async search(){return {results:[{source:'qa-alt',title:'Historia de prueba',url:api+'/alternate/manga',cover:api+'/qa/image.png',genres:['Action','Fantasy']}],nextPage:null};}}});
  const backend=createApp({cloudStore:state,tickets,publicConfig:{mode:'cloud',privateEncryption:'e2ee'},apiOrigin:api.replace('http:','https:'),frontendOrigins:[web],sources,logger:{warn(){},error(error){console.error(error);}}});
  apiServer.on('request',(req,res)=>{
    if(faults.images&&req.method==='GET'&&/^\/api\/chapters\/\d+\/images$/.test(req.url)||faults.progress&&req.method==='POST'&&req.url==='/api/progress'){
      res.writeHead(503,{'Content-Type':'application/json','Access-Control-Allow-Origin':web,'Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'QA_UNAVAILABLE',message:'Fallo temporal simulado en la prueba'}}));return;
    }
    if(req.url.startsWith('/qa/image.png')){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
    // Simula la terminación TLS de Render únicamente en esta prueba de localhost.
    req.headers['x-forwarded-proto']='https';backend(req,res);
  });
  const frontend=express(),prefix='/lector_manga';
  // Doble del Data API en OTRO origen respecto al proxy. Solo para esta QA local.
  frontend.use(prefix+'/qa-supabase',express.json({limit:'26mb'}));
  const sdk=async req=>memorySupabase(state,await state.authenticate(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]));
  frontend.get(prefix+'/qa-supabase/read',async(req,res)=>{
    try{res.json(await (await sdk(req)).from(req.query.table).select(req.query.columns).eq('user_id',req.query.owner).maybeSingle());}
    catch{res.status(401).json({data:null,error:{code:'AUTH_REQUIRED'}});}
  });
  frontend.post(prefix+'/qa-supabase/rpc',async(req,res)=>{
    try{res.json(await (await sdk(req)).rpc(req.body.name,req.body.args));}
    catch{res.status(401).json({data:null,error:{code:'AUTH_REQUIRED'}});}
  });
  const config={mode:'cloud',apiBase:api,supabaseUrl:'https://qa.supabase.co',supabasePublicKey:'sb_publishable_qa',privateEncryption:'e2ee'};
  frontend.get(prefix+'/config.js',(_req,res)=>res.type('js').send('window.LECTOR_CONFIG='+JSON.stringify(config)+';'));
  frontend.get(prefix+'/vendor/supabase.js',(_req,res)=>res.type('js').send(`window.supabase={createClient(){const key=new URLSearchParams(location.search).get('qa_user')||sessionStorage.getItem('lector-qa-user')||'a',users=${JSON.stringify(USERS)},user=users[key];sessionStorage.setItem('lector-qa-user',key);
  const request=(path,options={})=>fetch('${prefix}/qa-supabase/'+path,{...options,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}}).then(r=>r.json());
  return{auth:{async getSession(){return{data:{session:user?{access_token:key,user}:null},error:null}},onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},async signInWithOtp(){return{data:{user:null,session:null},error:null}},async signOut(){location.href=location.pathname+'?qa_user=none';return{error:null}}},
  from(table){let columns,owner,signal;return{select(value){columns=value;return this},eq(field,value){owner=value;return this},abortSignal(value){signal=value;return this},maybeSingle(){return request('read?'+new URLSearchParams({table,columns,owner}),{signal})}}},
  rpc(name,args){let signal;return{abortSignal(value){signal=value;return this},then(resolve,reject){return request('rpc',{method:'POST',body:JSON.stringify({name,args}),signal}).then(resolve,reject)}}}}}};`));
  frontend.use(prefix,express.static(fileURLToPath(new URL('../src/frontend/',import.meta.url))));
  webServer.on('request',frontend);
  return {api,web:web+prefix+'/',state,faults,async close(){for(const server of [apiServer,webServer]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const demo=await startAccountDemo();console.log('Prueba de cuentas: '+demo.web+' · Cuenta B: '+demo.web+'?qa_user=b');
  const stop=()=>demo.close();process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
