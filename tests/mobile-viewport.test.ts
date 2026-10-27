import assert from 'node:assert/strict';
import test from 'node:test';
import {mobileViewport} from '../apps/web/src/mobile-viewport';

const landscape={width:844,height:390,visibleHeight:390,keyboard:false};
test('mobile keyboard keeps the landscape canvas stable and tracks the visible answer area',()=>{
 const keyboard=mobileViewport(landscape,{width:844,height:175,visibleHeight:175},true,true);
 assert.equal(keyboard.height,390);assert.equal(keyboard.visibleHeight,175);assert.equal(keyboard.keyboard,true);
 assert.equal(mobileViewport(keyboard,{width:844,height:175,visibleHeight:175},false,true).keyboard,true);
 assert.equal(mobileViewport(keyboard,{width:844,height:390,visibleHeight:390},false,true).keyboard,false);
});
test('rotation and browser bars resize the layout instead of being mistaken for a keyboard',()=>{
 const rotated=mobileViewport(landscape,{width:390,height:844,visibleHeight:844},true,true);assert.equal(rotated.height,844);assert.equal(rotated.keyboard,false);
 const toolbar=mobileViewport(landscape,{width:844,height:350,visibleHeight:350},true,true);assert.equal(toolbar.height,350);assert.equal(toolbar.keyboard,false);
});
test('desktop viewport resizing stays responsive while a text field is focused',()=>{
 const resized=mobileViewport(landscape,{width:844,height:175,visibleHeight:175},true,false);assert.equal(resized.height,175);assert.equal(resized.keyboard,false);
});
