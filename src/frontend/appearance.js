// Se ejecuta antes del CSS para resolver el tema sin un destello claro.
(() => {
  const KEY = 'lector-manga.appearance.v1';
  const defaults = { theme: 'oled', accent: 'violet', custom: '#A78BFA', density: 'comfortable', flags: true, glass: true };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let settings;
  function normalize(value) {
    const result = { ...defaults, ...(value && typeof value === 'object' ? value : {}) };
    if (!['system','dark','oled','light'].includes(result.theme)) result.theme = defaults.theme;
    if (!['violet','cyan','crimson','custom'].includes(result.accent)) result.accent = defaults.accent;
    if (!/^#[\da-f]{6}$/i.test(result.custom)) result.custom = defaults.custom;
    if (!['comfortable','compact'].includes(result.density)) result.density = defaults.density;
    result.flags = result.flags !== false; result.glass = result.glass !== false;
    return result;
  }
  try { settings = normalize(JSON.parse(localStorage.getItem(KEY))); } catch { settings = normalize(); }
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
    .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum + v*[.2126,.7152,.0722][i],0);
  const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  function apply() {
    const theme = settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme;
    const light = theme === 'light';
    const palettes = { violet: light ? '#6D28D9' : '#A78BFA', cyan: light ? '#0E7490' : '#22D3EE', crimson: light ? '#BE123C' : '#FB7185' };
    const accent = settings.accent === 'custom' ? settings.custom : palettes[settings.accent];
    const backgrounds = light ? ['#FFFFFF','#EEF0F4','#F7F8FA'] : theme === 'oled' ? ['#000000','#080808','#151515'] : ['#0B0D12','#151821','#202431'];
    let textAccent = accent;
    const rgb = accent.slice(1).match(/../g).map(v => parseInt(v,16));
    for (let step=0; step<=100 && Math.min(...backgrounds.map(bg => contrast(textAccent,bg))) < 4.5; step++) {
      const amount = step/100, target = light ? 0 : 255;
      textAccent = '#' + rgb.map(v => Math.round(v+(target-v)*amount).toString(16).padStart(2,'0')).join('');
    }
    const root = document.documentElement;
    root.dataset.theme = theme; root.dataset.density = settings.density;
    root.dataset.flags = String(settings.flags); root.dataset.glass = String(settings.glass);
    root.style.colorScheme = light ? 'light' : 'dark';
    root.style.setProperty('--accent-color',accent); root.style.setProperty('--accent-text',textAccent);
    root.style.setProperty('--on-accent',contrast(accent,'#080808') >= contrast(accent,'#E0E0E0') ? '#080808' : '#E0E0E0');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[0]);
    window.dispatchEvent(new CustomEvent('appearancechange', { detail: { ...settings, resolvedTheme: theme } }));
  }
  window.LectorAppearance = {
    get: () => ({ ...settings }),
    set(patch) { settings = normalize({ ...settings,...patch }); apply(); try { localStorage.setItem(KEY,JSON.stringify(settings)); } catch { /* La preferencia sigue activa en esta sesión. */ } },
    reset() { settings = normalize(); this.set(settings); }
  };
  media.addEventListener('change', () => { if(settings.theme === 'system') apply(); });
  window.addEventListener('storage', event => { if(event.key === KEY) { try { settings=normalize(JSON.parse(event.newValue)); } catch { settings=normalize(); } apply(); } });
  apply();
})();
