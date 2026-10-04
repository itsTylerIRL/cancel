// Writes server/card_spec.json: the layer rules and relic art the card renderer needs, read straight out of the
// game's own source so the server draws characters exactly as the game does. Run after changing relics or layers:
//   node server/make_spec.mjs
import {readFileSync, writeFileSync} from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const data = readFileSync(root+'js/data.js', 'utf8'), game = readFileSync(root+'js/game.js', 'utf8');
const D = new Function(data+'; return {RELICS, TOKEN_MAP, TRIBES, SETS};')();
const a = game.indexOf('const BASE_LAYERS'), b = game.indexOf('function basePicks');
if(a<0 || b<a) throw new Error('layer tables not found in game.js');
const L = new Function(game.slice(a, b)+'; return {BASE_LAYERS, WEAR, SINGLE, DRAW_ORDER, TOKEN_SLOTS};')();
const index = JSON.parse(readFileSync(root+'assets/asset_index.json', 'utf8'));
const spec = { ...L, tint: D.TOKEN_MAP.milady.tint, token_map: D.TOKEN_MAP, assets: {Milady: index.Milady, Remilio: index.Remilio},
  relics: Object.fromEntries(D.RELICS.map(r=>[r.id, {icon:r.icon, rar:r.rar, set:r.set}])),
  tribes: Object.fromEntries(D.TRIBES.map(t=>[t.id, t.name])),
  sets: D.SETS.map(s=>({id:s.id, name:s.name, min:s.tiers[0][0]})) };
writeFileSync(root+'server/card_spec.json', JSON.stringify(spec));
console.log('card_spec.json:', Object.keys(spec.relics).length, 'relics,', spec.sets.length, 'sets');
