// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, readSettings, writeSettings, SETTINGS_KEY } from '../dist/check/settings.mjs';
import { fluidToneColors } from '../dist/check/tones.mjs';

test('原版默认材料和连续色调保持一致，端点衔接且没有固定调色板', () => {
  assert.deepEqual([DEFAULT_SETTINGS.fluidHue,DEFAULT_SETTINGS.fluidDepth,DEFAULT_SETTINGS.blur,DEFAULT_SETTINGS.frost], [320,25,20,7]);
  assert.deepEqual(fluidToneColors(false,0,33),fluidToneColors(false,360,33));
  assert.notDeepEqual(fluidToneColors(false,320,25),fluidToneColors(false,260,25));
  const settings=normalizeSettings({fluidHue:320.25,fluidDepth:25.5,blur:38.5,frost:0});
  assert.equal(settings.fluidHue,320.25); assert.equal(settings.blur,38.5); assert.equal(settings.frost,0);
});

test('滑杆边界和坏的持久设置不会破坏原生界面', () => {
  assert.equal(normalizeSettings({blur:500}).blur,40);
  assert.equal(normalizeSettings({fluidHue:-1}).fluidHue,0);
  assert.throws(()=>normalizeSettings({fluidHue:NaN}));
  assert.throws(()=>normalizeSettings({mesh:'true'}));
  assert.throws(()=>normalizeSettings({enabled:'false'}));
  assert.equal(readSettings({getItem:()=>'{"enabled":false}'}).enabled,false);
  assert.equal(readSettings({getItem:()=>'{"fluidHue":123}'}).enabled,true);
  assert.deepEqual(readSettings({getItem:()=>'{broken'}),DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({getItem:()=>'{"scheme":"invalid"}'}),DEFAULT_SETTINGS);
  let saved;
  const storage={setItem(key,value){assert.equal(key,SETTINGS_KEY);saved=value;},getItem(){return saved;}};
  const setting=normalizeSettings({fluidHue:0,frost:0,scheme:'light'});
  writeSettings(storage,setting); assert.deepEqual(readSettings(storage),setting);
  assert.doesNotThrow(()=>writeSettings({setItem(){throw new Error('denied');}},setting));
});
