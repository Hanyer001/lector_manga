import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
test.use({serviceWorkers:'block'});
let demo;
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterEach(async()=>{await demo.close();});
const selectControl=(page,id,value)=>page.locator('[data-select="'+id+'"] [data-value="'+value+'"]');

test('dialog nativo: pestañas, teclado, organización y cierre con Escape o fondo',async({page})=>{
  await page.goto(demo.web+'#library');
  const choose=page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}),dialog=page.locator('#chapter-controls');
  await choose.click();await expect(dialog).toHaveAttribute('open','');
  expect(await dialog.evaluate(el=>el.tagName)).toBe('DIALOG');
  await expect(dialog.getByRole('tab')).toHaveText(['Capítulos','Detalles y Fuentes','Organizar']);
  await expect(page.locator('#detail-panel-details')).toBeHidden();
  await dialog.getByRole('tab',{name:'Capítulos',exact:true}).focus();
  await dialog.getByRole('tab',{name:'Capítulos',exact:true}).press('ArrowRight');
  await expect(dialog.getByRole('tab',{name:'Detalles y Fuentes',exact:true})).toBeFocused();
  await expect(page.locator('#work-rating')).toHaveValue('');
  await expect(page.getByRole('heading',{name:'Una obra, varias fuentes',exact:true})).toBeVisible();
  await dialog.getByRole('tab',{name:'Organizar',exact:true}).click();
  await expect(page.locator('#series-private-toggle')).toBeVisible();
  await selectControl(page,'series-reading-state','on_hold').click();await page.locator('#save-series-library').click();
  await expect(page.locator('#series-edit-status')).toContainText('guardad');
  await dialog.press('Escape');await expect(dialog).toBeHidden();await expect(choose).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  await choose.click();await expect(dialog).toBeVisible();
  await page.mouse.click(2,2);await expect(dialog).toBeHidden();
  await page.locator('#manage-folders').click();await expect(page.locator('#folder-panel')).toHaveAttribute('open','');
  await page.locator('#folder-name').fill('Nueva carpeta de prueba');await page.locator('#folder-save').click();
  await expect(page.locator('#folder-list')).toContainText('Nueva carpeta de prueba');
  await page.locator('#folder-panel').press('Escape');await expect(page.locator('#folder-panel')).toBeHidden();
});

test('capítulos: invertir, filtrar por número, elegir rápidamente y guía de dos segundos',async({page})=>{
  await page.goto(demo.web+'#library');await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
  const rows=page.locator('#chapter-browser .chapter-row');await expect(rows).toHaveCount(3);
  await page.getByRole('button',{name:'Invertir orden de capítulos',exact:true}).click();
  await expect(rows.first()).toContainText('Capítulo 3');
  await page.getByRole('searchbox',{name:'Buscar capítulo',exact:true}).fill('2');await expect(rows).toHaveCount(1);
  await page.locator('#chapter-select').selectOption('3');
  await page.locator('#open-chapter').click();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 3');
  await expect(page.locator('#reader-touch-guide')).toBeVisible();
  expect(await page.locator('#reader-touch-guide').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(page.locator('#reader-touch-guide')).toContainText('Anterior');
  await expect(page.locator('#reader-touch-guide')).toBeHidden({timeout:4000});
  await expect(page.locator('nav[aria-label="Navegación principal"]')).toBeHidden();
});

test('banner y temas: portada a la izquierda y variables consistentes en todas las combinaciones',async({page})=>{
  await page.goto(demo.web+'#home');await expect(page.locator('#hero-cover')).toBeVisible();
  const hero=await page.locator('#continue-hero').evaluate(el=>{const cover=el.querySelector('#hero-cover'),copy=el.querySelector('.hero-copy'),backdrop=el.querySelector('#hero-backdrop');return{left:cover.getBoundingClientRect().right<=copy.getBoundingClientRect().left,filter:getComputedStyle(backdrop).filter,absolute:getComputedStyle(backdrop).position};});
  expect(hero.left).toBe(true);expect(hero.filter).toBe('blur(28px) brightness(0.35)');expect(hero.absolute).toBe('absolute');
  await page.locator('#show-settings').click();
  for(const theme of ['dark','oled','light','system']){
    await selectControl(page,'appearance-theme',theme).click();
    for(const accent of ['violet','cyan','crimson','custom']){
      await selectControl(page,'appearance-accent',accent).click();
      const tokens=await page.locator('html').evaluate(el=>{const style=getComputedStyle(el);return ['--surface-glass','--border-subtle','--accent-glow'].map(name=>style.getPropertyValue(name).trim());});
      expect(tokens.every(Boolean)).toBe(true);
      expect(await page.locator('header.topbar').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
  }
  await page.locator('#show-saved').click();await expect(page.locator('#saved-panel')).toBeVisible();
  await page.locator('#show-private').click();await expect(page.locator('#private-panel')).toBeVisible();
  await page.locator('#show-discover').click();await expect(page.locator('#discover-panel')).toBeVisible();
  await expect(page.locator('#private-panel')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('navegación sin View Transition y con movimiento reducido mantiene acciones y diálogos',async({page})=>{
  await page.addInitScript(()=>{document.startViewTransition=undefined;});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(demo.web+'#home');await page.locator('#show-saved').click();
  await expect(page.locator('#saved-panel')).toBeVisible();await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
  expect(await page.locator('#chapter-controls').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await page.locator('#chapter-controls').press('Escape');await page.locator('#show-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();await page.locator('#show-home').click();
  await expect(page.locator('#home-panel')).toBeVisible();
});
