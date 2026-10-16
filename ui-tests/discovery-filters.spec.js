import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
import {openDatabase} from '../src/storage/database.js';
import {createVaultEncryption} from '../src/frontend/vault-crypto.js';
import {USERS} from '../test/helpers/account-store.js';

test('Privada: mismos filtros, últimas lecturas primero y limpieza al bloquear',async({page})=>{
  const demo=await startAccountDemo({apiPort:0,webPort:0}),db=openDatabase(':memory:');
  const password='Contraseña ficticia de filtros 84';
  try {
    const folder=db.saveFolder('Colección privada');
    for(const [index,title] of ['Lectura anterior','Lectura más reciente','Sin empezar'].entries()) {
      const row=db.saveFavorite({source:'qa-local',titulo:title,url_origen:demo.api+'/qa/story/'+index,metadata:{genres:[index===0?'Romance':'Action'],authors:[index===0?'Autora anterior':'Autora reciente'],status:index===0?'completed':'ongoing'}});
      db.updateLibrary(row.id,{is_private:true,is_adult:index===0,folder_ids:index===0?[]:[folder.id],reading_state:index===2?'planned':'reading'});
      if(index<2){const [chapter]=db.saveChapters(row.id,[{title:'Capítulo 1',number:1,url:demo.api+'/qa/chapter/'+index}]);db.updateProgress({serie_id:row.id,capitulo_id:chapter.id,scroll_position_y:0,page_index:0,page_fraction:0});}
    }
    const state=db.exportState();for(const row of state.tables.Progress)row.timestamp=row.serie_id===1?100:200;
    const encrypted=await createVaultEncryption(state,password,USERS.a.id);encrypted.rawKey.fill(0);
    demo.state.vaults.set(USERS.a.id,{revision:1,envelope:encrypted.envelope});
    await page.goto(demo.web+'#private');
    await page.locator('#private-pin').fill(password);await page.getByRole('button',{name:'Desbloquear',exact:true}).click();
    await expect(page.locator('#private-library .series-title')).toHaveText(['Lectura más reciente','Lectura anterior','Sin empezar']);
    const heights=await page.locator('#private-library .series-card').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().height));
    expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(2);
    await expect(page.locator('#private-library-sort')).toBeVisible();
    await page.locator('#private-options summary').click();
    await page.locator('#private-source-filter').selectOption('qa-local');
    await page.locator('#private-genre-filter').selectOption('Action');
    await page.locator('#private-author-filter').selectOption('Autora reciente');
    await page.locator('#private-options summary').click();
    await page.locator('[data-select="private-publication-filter"] [data-value="ongoing"]').click();
    await page.locator('[data-select="private-reading-filter"] [data-value="reading"]').click();
    await expect(page.locator('#private-reading-filter')).toHaveValue('reading');
    await page.locator('#private-options summary').click();
    await page.locator('#private-folder-filter').selectOption(String(folder.id));
    await page.locator('#private-only-unread').check();
    await expect(page.locator('#private-library .series-title')).toHaveText(['Lectura más reciente']);
    await expect(page.locator('#folder-filter')).not.toContainText('Colección privada');
    await page.locator('#private-query').fill('inexistente');
    await expect(page.locator('#private-library')).toContainText('No hay lecturas con estos filtros');
    await page.locator('#private-clear-filters').click();
    await expect(page.locator('#private-library .series-card')).toHaveCount(3);
    await page.locator('#private-library-sort').selectOption('title');
    await expect(page.locator('#private-library .series-title')).toHaveText(['Lectura anterior','Lectura más reciente','Sin empezar']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#private-lock').click();
    await expect(page.locator('#private-library')).toBeEmpty();
    await expect(page.locator('#private-author-filter')).not.toContainText('Autora reciente');
    await expect(page.locator('#private-folder-filter')).not.toContainText('Colección privada');
    await expect(page.locator('#private-filter-chips')).toBeEmpty();
  }finally{db.close();await demo.close();}
});

test('Descubrir: catálogos visibles y explicación de coincidencias por filtros',async({page})=>{
  const demo=await startAccountDemo({apiPort:0,webPort:0});
  try {
    await page.route('**/api/discovery/recommendations',async route=>{
      await route.fulfill({json:{results:[{source:'qa-local',title:'Historia para explorar',url:demo.api+'/qa/recommend/4',genres:['Romance'],discoveryMatch:'filters',reason:'Por tus filtros · todavía sin afinidad confirmada con tus lecturas.'}],sources:[{id:'qa-local',name:'Fuente de prueba',status:'ok',candidates:30,count:1,messages:[]}],personalized:true}});
    });
    await page.goto(demo.web+'#discover');
    await expect(page.locator('#recommend-source-results')).toBeVisible();
    await expect(page.locator('#recommend-catalog-hint')).toBeVisible();
    await expect(page.locator('#recommend-catalog-copy')).toContainText('1 historia coincide con tus filtros');
    await expect(page.locator('#recommend-results')).toContainText('sin afinidad confirmada');
    await page.locator('#rec-explore-catalog').click();
    await expect(page.locator('#rec-mode')).toHaveValue('genres');
  }finally{await demo.close();}
});
