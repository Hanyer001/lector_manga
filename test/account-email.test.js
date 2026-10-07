import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('acceso por correo: enlace de un uso, URL limpia y recuperación de errores', async t => {
  const names = ['window', 'location', 'history'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const name of names) { const descriptor = originals.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  async function setup({ query = '', verificationError = null, sendError = null, linkSession = null } = {}) {
    const calls = { sent: [], verified: [], history: [] };
    let savedSession = linkSession;
    globalThis.location = { origin: 'https://reader.example.test', pathname: '/lector_manga/', href: 'https://reader.example.test/lector_manga/' + query };
    globalThis.history = { replaceState(_state, _title, value) { calls.history.push(value); location.href = new URL(value, location.origin).href; } };
    globalThis.window = { LECTOR_CONFIG: { mode: 'cloud', apiBase: 'https://api.example.test', supabaseUrl: 'https://accounts.example.test', supabasePublicKey: 'public-test-key' }, supabase: { createClient(_url, _key, options) {
      calls.options = options;
      return { auth: {
        async getSession() { return { data: { session: savedSession }, error: null }; },
        onAuthStateChange() {},
        async verifyOtp(value) { calls.verified.push(value); if (!verificationError) savedSession = { access_token: 'test-token', user: { id: 'test-user' } }; return { error: verificationError }; },
        async signInWithOtp(value) { calls.sent.push(value); return { error: sendError }; }
      } };
    } } };
    const network = await import(new URL('../src/frontend/network.js', import.meta.url).href + '?test=' + randomUUID());
    return { network, calls };
  }
  await t.test('solicita el enlace al correo sin entrar antes de verificarlo y conserva la ruta Pages', async () => {
    const { network, calls } = await setup();
    await assert.rejects(network.signIn('correo inválido'), /correo válido/);
    assert.equal(calls.sent.length, 0);
    await network.signIn(' reader@example.test ');
    assert.deepEqual(calls.sent, [{ email: 'reader@example.test', options: { emailRedirectTo: 'https://reader.example.test/lector_manga/' } }]);
    assert.equal(calls.options.auth.flowType, 'implicit');
    assert.equal(network.accountUser(), null);
  });
  await t.test('consume el hash con Supabase y lo retira de la URL antes de obtener la sesión', async () => {
    const { network, calls } = await setup({ query: '?token_hash=one-use-test&type=email&keep=1' });
    await network.initializeAccount();
    assert.deepEqual(calls.verified, [{ token_hash: 'one-use-test', type: 'email' }]);
    assert.deepEqual(calls.history, ['/lector_manga/?keep=1']);
    assert.equal(network.accountUser().id, 'test-user');
  });
  await t.test('los enlaces predeterminados limpian el fragmento de sesión sin depender del navegador que los pidió', async () => {
    const {network,calls}=await setup({query:'#access_token=ficticio&refresh_token=ficticio&type=magiclink',linkSession:{access_token:'ficticio',user:{id:'test-user'}}});
    await network.initializeAccount();
    assert.equal(network.accountUser().id,'test-user');assert.deepEqual(calls.history,['/lector_manga/']);assert.equal(location.href.includes('access_token'),false);
  });
  await t.test('un enlace expirado permite volver a solicitar acceso en la misma página', async () => {
    const { network, calls } = await setup({ query: '?token_hash=expired-test&type=email', verificationError: new Error('expired') });
    await assert.rejects(network.initializeAccount(), /expiró/);
    assert.equal(location.href.includes('token_hash'), false);
    await network.signIn('reader@example.test');
    assert.equal(calls.verified.length, 1);
    assert.equal(calls.sent.length, 1);
    assert.equal(network.accountUser(), null);
  });
  await t.test('no utiliza enlaces de recuperación ni muestra datos internos del proveedor', async () => {
    const { network, calls } = await setup({ query: '?token_hash=recovery-test&type=recovery', sendError: { code: 'over_email_send_rate_limit', message: 'internal secret-test' } });
    await assert.rejects(network.initializeAccount(), /no es válido/);
    assert.equal(calls.verified.length, 0);
    await assert.rejects(network.signIn('reader@example.test'), /límite de enlaces/);
    assert.equal(calls.sent.length, 1);
  });
});
