import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
import {openDatabase} from '../src/storage/database.js';
import {USERS} from '../test/helpers/account-store.js';
let demo;
test.use({serviceWorkers:'block'});
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0,alternatives:true});});
test.afterEach(async()=>{await demo.close();});

test('numeración común entre fuentes: guardar, retomar y conservar el progreso original',async({page})=>{
  const db=openDatabase(':memory:');let other;
  try{
    db.restoreState(demo.state.states.get(USERS.a.id).state);
    other=db.saveFavorite({source:'qa-alt',titulo:'Otra edición',url_origen:demo.api+'/alternate/manga'});
    db.saveChapters(other.id,[{title:'Prólogo',number:0,url:demo.api+'/qa/chapter/0'}]);db.linkSeries(1,other.id);
    demo.state.states.set(USERS.a.id,{revision:2,state:db.exportState()});
  }finally{db.close();}
  await page.goto(demo.web+'#library?status=reading&q=Historia');
  await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();await page.getByRole('tab',{name:'Detalles y Fuentes',exact:true}).click();
  await page.locator('#alignment-editor summary').click();await page.locator('#alignment-chapter').selectOption({label:'Capítulo 2'});await page.locator('#alignment-number').fill('0');
  await page.locator('#alignment-save').click();await expect(page.locator('#alignment-status')).toContainText('corresponde al número común 0');
  await page.getByRole('tab',{name:'Capítulos',exact:true}).click();await expect(page.locator('#chapter-browser .chapter-row').first()).toContainText('Capítulo 2 · Orden común 0');
  await page.getByRole('tab',{name:'Detalles y Fuentes',exact:true}).click();await page.locator('#edition-select').selectOption(String(other.id));
  await page.locator('#edition-from').selectOption('1');await expect(page.locator('#edition-transfer')).toContainText('capítulo 0');await page.locator('#edition-transfer').click();
  await expect(page.locator('#edition-status')).toContainText('Continuación preparada');
  const snapshot=demo.state.states.get(USERS.a.id).state.tables;
  expect(snapshot.Progress.find(row=>row.serie_id===1).capitulo_id).toBe(2);expect(snapshot.Progress.find(row=>row.serie_id===other.id).capitulo_id).toBe(snapshot.Chapters.find(row=>row.serie_id===other.id).id);
  await page.goBack();await expect(page.locator('#chapter-controls')).toBeHidden();await expect(page.locator('#library-query')).toHaveValue('Historia');await expect(page.locator('#reading-filter')).toHaveValue('reading');
  await page.reload();await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();await page.getByRole('tab',{name:'Detalles y Fuentes',exact:true}).click();
  await page.locator('#edition-select').selectOption('1');await page.locator('#alignment-editor summary').click();await page.locator('#alignment-chapter').selectOption('2');await expect(page.locator('#alignment-number')).toHaveValue('0');
  await page.locator('#alignment-remove').click();await expect(page.locator('#alignment-status')).toContainText('Ajuste retirado');
});

test('reintento local no repite otras fuentes y guarda fechas de éxito y fallo',async({page})=>{
  let alternate=0,primary=0;
  await page.route('**/api/sources/qa-local/search?**',async route=>{primary++;await route.continue();});
  await page.route('**/api/sources/qa-alt/search?**',async route=>{alternate++;if(alternate===1)await route.fulfill({status:503,json:{error:{message:'Fallo puntual de prueba'}},headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}});else await route.continue();});
  await page.goto(demo.web+'#explore?q=Historia&source=all');await expect(page.locator('#search-results .series-card')).toHaveCount(1);
  await expect(page.locator('#search-status')).toContainText('1 fuente con error');
  await expect(page.locator('#catalog-source-status')).toContainText('Última respuesta correcta:');await expect(page.locator('#catalog-source-status')).toContainText('Último fallo:');
  await page.getByRole('button',{name:'Reintentar Otra fuente de prueba',exact:true}).click();await expect(page.locator('#search-results .series-card')).toHaveCount(2);expect(primary).toBe(1);expect(alternate).toBe(2);
  const history=await page.evaluate(()=>localStorage.getItem('lector-manga.catalog-health.v1'));expect(history).toContain('lastSuccess');expect(history).toContain('lastFailure');expect(history).not.toContain('Historia');expect(history).not.toContain('http');
  await page.reload();await expect(page.locator('#catalog-source-status')).toContainText('Último fallo:');
});

test('Buscar conserva fuente y consulta al volver de una ficha y del lector temporal',async({page})=>{
  await page.goto(demo.web+'#explore?q=Historia&source=qa-alt');await page.getByRole('button',{name:'Ver Historia de prueba',exact:true}).click();
  await expect(page.locator('.series-preview')).toBeVisible();await page.goBack();await expect(page.locator('.series-preview')).toBeHidden();
  await expect(page.locator('#search-query')).toHaveValue('Historia');await expect(page.locator('#search-source')).toHaveValue('qa-alt');
  await page.getByRole('button',{name:'Ver Historia de prueba',exact:true}).click();await page.getByRole('button',{name:'Leer primer capítulo',exact:true}).click();await expect(page.locator('#reader')).toBeVisible();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 1');
  await page.goBack();await expect(page.locator('#search-panel')).toBeVisible();await expect(page.locator('#search-source')).toHaveValue('qa-alt');await expect(page.locator('#search-query')).toHaveValue('Historia');
  await page.goForward();await expect(page.locator('#reader')).toBeVisible();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 1');
});

test('Descubrir restaura etiquetas, catálogo, búsqueda y orden desde URL e historial',async({page})=>{
  const hash='#discover?genre=action&catalog=qa-local&mode=genres&country=KR&q=Recomendaci%C3%B3n&sort=title';
  await page.goto(demo.web+hash);await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);
  await expect(page.locator('#rec-country')).toHaveValue('KR');await expect(page.locator('#rec-mode')).toHaveValue('genres');await expect(page.locator('#rec-result-sort')).toHaveValue('title');await expect(page.locator('#rec-result-query')).toHaveValue('Recomendación');
  await page.locator('#recommend-results .series-choice').first().click();await expect(page.locator('.series-preview')).toBeVisible();await page.goBack();await expect(page.locator('.series-preview')).toBeHidden();await expect(page.locator('#rec-result-query')).toHaveValue('Recomendación');
  await page.locator('#discovery-result-options summary').click();await page.locator('#rec-result-sort').selectOption('source');await expect(page).toHaveURL(/sort=source/);await page.goBack();await expect(page.locator('#rec-result-sort')).toHaveValue('title');
  await page.reload();await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);await expect(page.locator('#rec-country')).toHaveValue('KR');
});

test('Descubrir reintenta solo el proveedor fallido y retiene las demás historias',async({page})=>{
  const bodies=[];
  await page.route('**/api/discovery/recommendations',async route=>{
    const body=route.request().postDataJSON();bodies.push(body);const retry=body.filters.sources.length===1&&body.filters.sources[0]==='qa-alt';
    await route.fulfill({json:{results:[{source:retry?'qa-alt':'qa-local',title:retry?'Resultado recuperado':'Resultado conservado',url:demo.api+'/qa/'+(retry?'alt':'local'),genres:['Action']}],sources:retry?[{id:'qa-alt',name:'Otra fuente de prueba',status:'ok',candidates:1}]:[{id:'qa-local',name:'Fuente de prueba',status:'ok',candidates:1},{id:'qa-alt',name:'Otra fuente de prueba',status:'error',messages:['Fallo de prueba']}],personalized:false}});
  });
  await page.goto(demo.web+'#discover');await expect(page.locator('#recommend-results')).toContainText('Resultado conservado');
  await page.getByRole('button',{name:'Reintentar Otra fuente de prueba',exact:true}).click();await expect(page.locator('#recommend-results')).toContainText('Resultado recuperado');await expect(page.locator('#recommend-results')).toContainText('Resultado conservado');expect(bodies).toHaveLength(2);expect(bodies[1].filters.sources).toEqual(['qa-alt']);
});

test('Publicación se filtra con un toque fuera del desplegable y restaura el chip con Atrás',async({page})=>{
  await page.goto(demo.web+'#library');const chips=page.locator('#publication-state-chips');await expect(chips).toBeVisible();
  await chips.getByRole('button',{name:'En emisión',exact:true}).click();await expect(page.locator('#series-grid .series-card')).toHaveCount(0);await expect(page).toHaveURL(/publication=ongoing/);
  await chips.getByRole('button',{name:'Sin datos',exact:true}).click();await expect(page.locator('#series-grid .series-card')).toHaveCount(1);
  await page.goBack();await expect(chips.getByRole('button',{name:'En emisión',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#publication-filter')).toBeHidden();
});
