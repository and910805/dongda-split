import assert from 'node:assert/strict';
import test from 'node:test';
import {acquireModalEnvironment} from '../src/modal-environment.mjs';

function element(hidden=null){
  const attributes=new Map();
  if(hidden!==null)attributes.set('aria-hidden',hidden);
  return {
    inert:false,
    getAttribute:name=>attributes.has(name)?attributes.get(name):null,
    setAttribute:(name,value)=>attributes.set(name,value),
    removeAttribute:name=>attributes.delete(name)
  };
}

test('巢狀 Modal 不受卸載順序影響並完整解除背景鎖定',()=>{
  const originalDocument=globalThis.document;
  const app=element(),parentOverlay=element(),childOverlay=element();
  const body={style:{overflow:'auto'},children:[app,parentOverlay]};
  parentOverlay.parentElement=body;
  childOverlay.parentElement=body;
  globalThis.document={body};

  try{
    const releaseParent=acquireModalEnvironment(parentOverlay);
    body.children.push(childOverlay);
    const releaseChild=acquireModalEnvironment(childOverlay);

    releaseParent();
    assert.equal(document.body.style.overflow,'hidden');
    assert.equal(app.inert,true);

    releaseChild();
    assert.equal(document.body.style.overflow,'auto');
    assert.equal(app.inert,false);
    assert.equal(app.getAttribute('aria-hidden'),null);
  }finally{
    globalThis.document=originalDocument;
  }
});
