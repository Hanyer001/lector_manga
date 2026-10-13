import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
import {openDatabase} from '../src/storage/database.js';
import {USERS} from '../test/helpers/account-store.js';

test('Descubrir: tres favoritos y búsquedas guardadas persisten por cuenta; novedades y terminadas consultan el catálogo',async({page})=>{
  const demo=await startAccountDemo({apiPort:0,webPort:0}),db=openDatabase(':memory:');
  try{
    db.restoreState(demo.state.states.get(USERS.a.id).state);
    for(const [index,title] of ['Segunda favorita','Tercera favorita','Título privado'].entries()){
      const row=db.saveFavorite({source:'qa-local',titulo:title,url_origen:demo.api+'/qa/story/'+index,metadata:{genres:['Action','Fantasy']}});
      if(index===2)db.updateLibrary(row.id,{is_private:true});
    }
    demo.state.states.set(USERS.a.id,{revision:2,state:db.exportState()});
    const requests=[];
    await page.route('**/api/discovery/recommendations',async route=>{
      const body=route.request().postDataJSON();requests.push(body);
      await route.fulfill({json:{results:[{source:'qa-local',title:body.filters.status==='completed'?'Historia terminada':body.filters.catalogOrder==='newest'?'Nueva incorporación':'Para explorar',url:demo.api+'/qa/recommend/90',genres:['Action','Fantasy'],status:body.filters.status==='completed'?'completed':'ongoing'}],sources:[{id:'qa-local',name:'Fuente de prueba',status:'ok',candidates:1,count:1}],personalized:false}});
    });
    await page.goto(demo.web+'#discover');
    await page.locator('#rec-favorites-panel summary').click();
    await expect(page.locator('#rec-favorite-1')).not.toContainText('Título privado');
    await page.locator('#rec-favorite-1').selectOption('1');await page.locator('#rec-favorite-2').selectOption('2');await page.locator('#rec-favorite-3').selectOption('2');
    await page.getByRole('button',{name:'Guardar favoritos',exact:true}).click();
    await expect(page.locator('#rec-personal-status')).toContainText('obras distintas');
    await page.locator('#rec-favorite-3').selectOption('3');await page.getByRole('button',{name:'Guardar favoritos',exact:true}).click();
    await expect(page.locator('#rec-favorite-count')).toHaveText('3 de 3 elegidos');
    await page.locator('[data-rec-collection="newest"]').click();
    await expect(page.locator('#recommend-results')).toContainText('Nueva incorporación');
    expect(requests.at(-1).mode).toBe('genres');expect(requests.at(-1).filters.catalogOrder).toBe('newest');
    await page.locator('#rec-customize summary').first().click();
    await page.locator('#rec-quick-genres [data-discovery-tag="action"]').click();
    await page.locator('#rec-searches-panel summary').click();
    await page.locator('#rec-search-name').fill('Acción reciente');await page.getByRole('button',{name:'Guardar búsqueda',exact:true}).click();
    await expect(page.getByRole('button',{name:'Aplicar búsqueda Acción reciente',exact:true})).toBeVisible();
    await page.locator('[data-rec-collection="completed"]').click();
    await expect(page.locator('#recommend-results')).toContainText('Historia terminada');expect(requests.at(-1).filters.status).toBe('completed');
    await page.getByRole('button',{name:'Aplicar búsqueda Acción reciente',exact:true}).click();
    await expect(page.locator('[data-rec-collection="newest"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#rec-selected-tags')).toContainText('Acción');
    await page.reload();
    await expect(page.locator('#rec-favorite-count')).toHaveText('3 de 3 elegidos');
    await page.locator('#rec-favorites-panel summary').click();await expect(page.locator('#rec-favorite-3')).toHaveValue('3');
    await page.locator('#rec-searches-panel summary').click();
    await expect(page.getByRole('button',{name:'Aplicar búsqueda Acción reciente',exact:true})).toBeVisible();
    await page.locator('#rec-search-name').fill('Acción reciente');await page.getByRole('button',{name:'Guardar búsqueda',exact:true}).click();
    await expect(page.locator('#rec-saved-count')).toHaveText('1 guardada');
    await page.getByRole('button',{name:'Eliminar búsqueda Acción reciente',exact:true}).click();
    await expect(page.locator('#rec-saved-count')).toHaveText('0 guardadas');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.goto(demo.web+'?qa_user=b#discover');
    await expect(page.locator('#rec-favorite-count')).toHaveText('0 de 3 elegidos');
    await expect(page.locator('#rec-saved-count')).toHaveText('0 guardadas');
  }finally{db.close();await demo.close();}
});

test('invitado: búsquedas guardadas sobreviven a recargar y los favoritos ofrecen empezar la biblioteca',async({page})=>{
  const demo=await startAccountDemo({apiPort:0,webPort:0});
  try{
    await page.goto(demo.web+'?qa_user=none#discover');
    await page.locator('#rec-favorites-panel summary').click();await expect(page.locator('#rec-favorite-empty')).toBeVisible();
    await page.locator('#rec-searches-panel summary').click();
    await page.locator('#rec-search-name').fill('Mi búsqueda local');await page.getByRole('button',{name:'Guardar búsqueda',exact:true}).click();
    await expect(page.locator('#rec-saved-count')).toHaveText('1 guardada');
    await page.reload();await page.locator('#rec-searches-panel summary').click();
    await expect(page.getByRole('button',{name:'Aplicar búsqueda Mi búsqueda local',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await demo.close();}
});
