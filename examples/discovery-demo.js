// Prueba visual aislada: catálogo ficticio y SQLite en memoria, sin favoritos reales.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createApp} from '../src/backend/app.js';
import {openDatabase} from '../src/storage/database.js';
const panels=await Promise.all([1,2,3].map(i=>readFile(new URL(`../test/fixtures/reader-${i}.png`,import.meta.url))));
const images=createServer((req,res)=>{res.setHeader('Content-Type','image/png');res.end(panels[(Number(req.url.split('/').at(-1))||0)%3]);});images.listen(0,'127.0.0.1');await once(images,'listening');
const origin=`http://127.0.0.1:${images.address().port}`;
const catalog=[['Jardín de las horas','Fantasy','Reincarnation'],['El jardín del tiempo','Fantasy','Reincarnation'],['Una carta en primavera','Romance','School Life'],['El regreso del guardián','Fantasy','Reincarnation'],['La torre del amanecer','Action','Martial Arts'],['Otro día en el jardín','Fantasy','Reincarnation'],['El último hechicero','Fantasy','Magic'],['El café de las estrellas','Romance','School Life'],['Contrato con la luna','Fantasy','Reincarnation']].map(([title,genre,theme],i)=>({title,url:origin+'/title/'+i,cover:origin+'/cover/'+i,genres:[genre],themes:[theme],authors:[i<2?'Autora del jardín':'Autor '+i],country:'KR',status:'completed',description:'Obra ficticia para comprobar la interfaz de recomendaciones.'}));
const database=openDatabase(':memory:');
if(process.env.PRIVATE_DEMO==='1')for(const [index,item] of catalog.entries())item.contentRating=index>=6?'adult':'safe';
const sources=new Map(['mangadex','demo-alternativa'].map((id,i)=>[id,{id,name:i?'Otra fuente · prueba':'MangaDex · prueba',baseUrl:origin+'/',pageOrigins:[origin],pageOrigin:origin,imageOrigins:[origin],languages:['es'],userAgent:'DiscoveryDemo/1.0',capabilities:{search:true,manga:true,chapters:true,images:true,recommend:true,adult:true},scraper:{
  recommend:async filters=>({results:catalog.slice(3).filter((item,index)=>index%2===i&&Boolean(item.contentRating==='adult')===Boolean(filters?.adult))}),search:async(query,options)=>({results:catalog.filter(item=>item.title.toLowerCase().includes(query.toLowerCase())&&Boolean(item.contentRating==='adult')===Boolean(options?.adult)),nextPage:null}),
  getManga:async url=>({manga:catalog.find(m=>m.url===url)??catalog[0]}),
  getChapters:async url=>({manga:catalog.find(m=>m.url===url)??catalog[0],chapters:Array.from({length:35},(_,n)=>({title:`Capítulo ${n+1}`,number:n+1,url:`${url}/chapter/${n+1}`}))}),
  getChapterImages:async url=>({chapter:{title:'Capítulo de prueba',url},images:panels.map((_,index)=>({index:index+1,url:origin+'/image/'+index,referer:url}))})
}}]));
for(let i=0;i<3;i++){
 const m=catalog[i],saved=database.saveFavorite({source:i===1?'demo-alternativa':'mangadex',titulo:m.title,url_origen:m.url,portada:m.cover,metadata:m});
 const result=await sources.get(saved.source).scraper.getChapters(m.url);const chapters=database.saveChapters(saved.id,result.chapters);
 if(i===0){database.updateProgress({serie_id:saved.id,capitulo_id:chapters[4].id,scroll_position_y:300,page_index:1,page_fraction:.2});database.updateWorkFeedback(saved.work_id,{sentiment:'like',rating:9});}
}
const server=createServer(createApp({database,sources}));server.listen(Number(process.env.DEMO_PORT??3211),'127.0.0.1');await once(server,'listening');console.log(`Demo de recomendaciones: http://127.0.0.1:${server.address().port}/#home`);
const stop=()=>{server.closeAllConnections();images.closeAllConnections();server.close();images.close();database.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
