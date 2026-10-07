import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateSession,normalizePrivateSession} from '../src/frontend/private-session.js';
function fixture(preferences){
  let time=0,locks=0,masked=false,timer;const session=createPrivateSession({preferences,now:()=>time,lock:()=>locks++,mask:value=>{masked=value;},schedule:callback=>{timer=callback;return 1;},cancel:()=>{timer=undefined;}});
  return {session,advance:ms=>{time+=ms;},fire:()=>timer?.(),get locks(){return locks;},get masked(){return masked;}};
}
test('sesión privada: actividad renueva 30 minutos sin límite absoluto de una hora',()=>{
  const f=fixture();f.session.start();for(let i=0;i<6;i++){f.advance(20*60000);f.session.activity();}assert.equal(f.locks,0);f.advance(30*60000);f.fire();assert.equal(f.locks,1);f.session.activity();assert.equal(f.locks,1);
});
test('sesión privada: oculta inmediatamente, vuelve antes de dos minutos y conserva desbloqueo',()=>{
  const f=fixture();f.session.start();f.session.visibility(true);assert.equal(f.masked,true);f.advance(119999);f.session.visibility(false);assert.equal(f.masked,false);assert.equal(f.locks,0);f.session.activity();assert.equal(f.session.check(),true);
});
test('sesión privada: verifica el plazo al volver de un teléfono que suspendió los timers',()=>{
  const f=fixture();f.session.start();f.session.visibility(true);f.advance(120000);f.session.visibility(false);assert.equal(f.locks,1);assert.equal(f.masked,false);f.session.activity();assert.equal(f.session.check(),false);
});
test('sesión privada: respeta inactividad durante una pausa y aplica tiempos nuevos sin renovarlos',()=>{
  const f=fixture({idleMinutes:5,backgroundMinutes:10});f.session.start();f.advance(4*60000);f.session.visibility(true);f.advance(60000);f.session.visibility(false);assert.equal(f.locks,1);
  const g=fixture();g.session.start();g.advance(6*60000);g.session.configure({idleMinutes:5,backgroundMinutes:2});assert.equal(g.locks,1);
});
test('sesión privada: bloqueo inmediato opcional y stop cancela el bloqueo pendiente',()=>{
  const f=fixture({idleMinutes:60,backgroundMinutes:0});f.session.start();f.session.visibility(true);assert.equal(f.locks,1);
  const g=fixture();g.session.start();g.session.visibility(true);g.session.stop();g.advance(60*60000);g.fire();assert.equal(g.locks,0);assert.equal(g.masked,false);
  assert.deepEqual(normalizePrivateSession({idleMinutes:Infinity,backgroundMinutes:-1}),{idleMinutes:30,backgroundMinutes:2});assert.deepEqual(normalizePrivateSession(null),{idleMinutes:30,backgroundMinutes:2});
});
