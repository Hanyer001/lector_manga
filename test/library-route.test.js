import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLibraryRoute,libraryRouteHash} from '../src/frontend/library-route.js';

test('rutas de biblioteca conservan filtros y caracteres al compartir el fragmento',()=>{
  const filters={status:'reading',source:'mangadex',q:'Acción & fantasía',genre:'Acción',author:'Autora',publication:'ongoing',folder:'3',unread:'1',sort:'title'};
  assert.deepEqual(parseLibraryRoute(libraryRouteHash('library',filters)),{view:'library',filters});
  assert.equal(libraryRouteHash('library',{status:'reading',source:'mangadex',sort:'recent'}),'#library?status=reading&source=mangadex');
});
test('rutas ignoran valores inválidos y vuelven a Inicio ante vistas desconocidas',()=>{
  assert.deepEqual(parseLibraryRoute('#library?status=invalid&source=https://otro&folder=-2&sort=invalid&unread=0&publication=no'),{view:'library',filters:{}});
  assert.deepEqual(parseLibraryRoute('#desconocido?status=reading'),{view:'home',filters:{}});
  assert.deepEqual(parseLibraryRoute('#library'),{view:'library',filters:{}});
});
test('rutas privadas y otras vistas no incluyen filtros ni búsquedas',()=>{
  assert.equal(libraryRouteHash('private',{q:'Título privado',status:'reading'}),'#private');
  assert.deepEqual(parseLibraryRoute('#private?q=secreto'),{view:'private',filters:{}});
  assert.equal(libraryRouteHash('home',{source:'mangadex'}),'#home');
});
