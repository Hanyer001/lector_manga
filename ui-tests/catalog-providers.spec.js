import{test,expect}from'@playwright/test';import{startAccountDemo}from'../examples/account-demo.js';
let demo;test.use({serviceWorkers:'block'});test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});test.afterEach(async()=>{await demo.close();});
test('catálogo de fichas permite buscar lectura sin ofrecer capítulos o guardar una fuente vacía',async({page})=>{
 const item={source:'anilist',title:'Berserk',url:'https://anilist.co/manga/30002/',metadataOnly:true,description:'Ficha de prueba',genres:['Action'],authors:['Kentaro Miura']};
 await page.route('**/api/sources',async route=>{const response=await route.fetch(),sources=await response.json();await route.fulfill({json:[...sources,{id:'anilist',name:'AniList · Fichas',enabled:true,metadataOnly:true,languages:[],capabilities:{search:true,manga:true,chapters:false,images:false,recommend:true}}]});});
 await page.route('**/api/sources/anilist/search?*',route=>route.fulfill({json:{source:'anilist',results:[item],nextPage:null}}));
 await page.route('**/api/sources/anilist/manga?*',route=>route.fulfill({json:{manga:item}}));
 await page.goto(demo.web+'#explore');await expect(page.locator('#search-panel')).toBeVisible();
 await page.locator('#search-source').selectOption('anilist');await page.locator('#search-query').fill('Berserk');await page.locator('#search-submit').click();
 await page.getByRole('button',{name:'Ver Berserk',exact:true}).click();const preview=page.locator('.series-preview');await expect(preview).toBeVisible();
 await expect(preview.getByRole('button',{name:'Buscar dónde leer',exact:true})).toBeVisible();await expect(preview.locator('[data-add]')).toBeHidden();await expect(preview.locator('[data-save]')).toBeHidden();await expect(preview.locator('.preview-chapters')).toBeHidden();
 await preview.getByRole('button',{name:'Buscar dónde leer',exact:true}).click();await expect(page.locator('.source-alternatives')).toBeVisible();
});
test('tipografía editorial local y números tabulares en temas oscuro y claro',async({page})=>{
 await page.goto(demo.web+'#home');await expect(page.locator('#home-panel')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 const fonts=await page.evaluate(()=>({heading:getComputedStyle(document.querySelector('h1')).fontFamily,label:getComputedStyle(document.querySelector('.eyebrow')).fontFamily,body:getComputedStyle(document.body).fontVariantNumeric,weight:getComputedStyle(document.querySelector('h1')).fontWeight,loaded:document.fonts.check('700 16px "Plus Jakarta Sans"')&&document.fonts.check('500 12px "JetBrains Mono"')}));
 expect(fonts.heading).toContain('Plus Jakarta Sans');expect(fonts.label).toContain('JetBrains Mono');expect(fonts.body).toBe('tabular-nums');expect(fonts.weight).toBe('700');expect(fonts.loaded).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
