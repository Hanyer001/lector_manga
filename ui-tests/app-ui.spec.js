import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
test.use({serviceWorkers:'block'});
let demo;
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterEach(async()=>{await demo.close();});
const control=(page,id,value)=>page.locator('[data-select="'+id+'"] [data-value="'+value+'"]');

test('controles visuales: preferencias persistentes, filtros sincronizados y nota guardada',async({page})=>{
  await page.goto(demo.web+'#settings');
  await control(page,'appearance-theme','light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('#appearance-theme')).toBeHidden();
  await expect(page.locator('#appearance-theme')).toHaveValue('light');
  await control(page,'appearance-theme','oled').click();
  await control(page,'appearance-accent','cyan').click();
  await control(page,'appearance-density','compact').click();
  await page.reload();
  await expect(control(page,'appearance-accent','cyan')).toHaveAttribute('aria-pressed','true');
  await expect(control(page,'appearance-density','compact')).toHaveAttribute('aria-pressed','true');
  await page.locator('#show-saved').click();
  await control(page,'reading-filter','completed').click();
  await expect(page.locator('#reading-filter')).toHaveValue('completed');
  await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
  await page.getByRole('button',{name:'Quitar filtro Completado',exact:true}).click();
  await expect(control(page,'reading-filter','')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
  await control(page,'work-rating','8').click();
  await expect(page.locator('#work-status')).toContainText('guardaron');
  await page.reload();await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
  await expect(control(page,'work-rating','8')).toHaveAttribute('aria-pressed','true');
  await control(page,'work-rating','').click();
  await expect(page.locator('#work-rating')).toHaveValue('');
});

test('bienvenida: dos acciones reales y desaparición al guardar la primera historia',async({page})=>{
  await page.goto(demo.web+'?qa_user=b#home');
  const welcome=page.locator('#library-welcome');
  await expect(welcome).toBeVisible();await expect(welcome.locator('svg')).toBeVisible();
  await expect(page.locator('#home-content')).toBeHidden();
  await welcome.getByRole('button',{name:'Explorar catálogos',exact:true}).click();
  await expect(page.locator('#discover-panel')).toBeVisible();
  await page.locator('#show-saved').click();
  await welcome.getByRole('button',{name:'Pegar enlace de serie',exact:true}).click();
  await expect(page.locator('#add-panel')).toBeVisible();
  await expect(page.locator('#series-url')).toBeFocused();
  await page.locator('#series-url').fill(demo.api+'/qa/manga');await page.locator('#add-series').click();
  await expect(welcome).toBeHidden();await expect(page.locator('#series-grid .series-card')).toHaveCount(1);
  await page.locator('#show-home').click();await expect(welcome).toBeHidden();
});

test('tarjetas: proporción estricta, densidad distinta y navegación fuera del lector',async({page})=>{
  await page.goto(demo.web+'#discover');
  await expect(page.locator('#recommend-results .series-card').first()).toBeVisible();
  const sizes=await page.locator('#recommend-results .series-card').evaluateAll(cards=>cards.slice(0,8).map(card=>{const cover=card.querySelector('.series-cover').getBoundingClientRect();return {ratio:cover.width/cover.height,height:card.getBoundingClientRect().height};}));
  for(const size of sizes)expect(size.ratio).toBeCloseTo(2/3,2);
  expect(Math.max(...sizes.map(size=>size.height))-Math.min(...sizes.map(size=>size.height))).toBeLessThan(2);
  const columns=()=>page.locator('#recommend-results').evaluate(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  const comfortable=await columns();
  await page.locator('#show-settings').click();await control(page,'appearance-density','compact').click();
  await page.locator('#show-discover').click();expect(await columns()).toBeGreaterThan(comfortable);
  const nav=page.getByRole('navigation',{name:'Navegación principal'});
  if(page.viewportSize().width<768){
    await expect(nav.locator('button:visible')).toHaveText(['Inicio','Biblioteca','Descubrir','Privada','Ajustes']);
    const position=await nav.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:innerHeight}));expect(Math.abs(position.height-position.bottom)).toBeLessThan(2);
  }else{
    expect(await page.locator('header').evaluate(el=>getComputedStyle(el).position)).toBe('sticky');
    expect(await page.locator('header').evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('blur(16px)');
  }
  await page.locator('#show-saved').click();await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).click();
  await expect(page.locator('#reader')).toBeVisible();await expect(nav).toBeHidden();
  await expect(nav).toHaveAttribute('inert','');
  const controls=page.getByRole('button',{name:'Controles',exact:true});if(await controls.isVisible())await controls.click();
  await page.locator('#reader-library').click();await expect(nav).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('cargas: biblioteca, búsqueda y recomendaciones muestran esqueletos y los retiran',async({page})=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/series',async route=>{await pending;await route.continue();});
  await page.goto(demo.web+'#library');
  await expect(page.locator('#series-grid[aria-busy=true] .grid-skeleton')).toHaveCount(8);
  release();await expect(page.locator('#series-grid')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#series-grid .grid-skeleton')).toHaveCount(0);
  let releaseSearch;const searchPending=new Promise(resolve=>{releaseSearch=resolve;});
  await page.route('**/api/sources/*/search?*',async route=>{await searchPending;await route.continue();});
  await page.goto(demo.web+'#explore');await page.locator('#search-query').fill('Historia');
  await expect(page.locator('#search-results [aria-busy=true] .grid-skeleton')).toHaveCount(6);
  releaseSearch();await expect(page.locator('#search-results .series-card')).toHaveCount(1);
  await expect(page.locator('#search-results .grid-skeleton')).toHaveCount(0);
  let releaseRecommendations;const recommendationPending=new Promise(resolve=>{releaseRecommendations=resolve;});
  await page.route('**/api/discovery/recommendations',async route=>{await recommendationPending;await route.continue();});
  await page.locator('#show-discover').click();
  await expect(page.locator('#recommend-results[aria-busy=true] .grid-skeleton')).toHaveCount(6);
  releaseRecommendations();await expect(page.locator('#recommend-results .series-card').first()).toBeVisible();
  await expect(page.locator('#recommend-results .grid-skeleton')).toHaveCount(0);
});
