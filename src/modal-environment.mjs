let bodyLockCount=0;
let originalBodyOverflow='';
const elementLocks=new WeakMap();

function lockElement(element){
  let state=elementLocks.get(element);
  if(!state){
    state={
      count:0,
      inert:Boolean(element.inert),
      hidden:element.getAttribute('aria-hidden')
    };
    elementLocks.set(element,state);
  }
  state.count+=1;
  element.inert=true;
  element.setAttribute('aria-hidden','true');
}

function unlockElement(element){
  const state=elementLocks.get(element);
  if(!state)return;
  state.count-=1;
  if(state.count>0)return;
  element.inert=state.inert;
  if(state.hidden===null)element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden',state.hidden);
  elementLocks.delete(element);
}

export function acquireModalEnvironment(overlay){
  if(typeof document==='undefined'||!overlay)return()=>{};
  const blocked=[...(overlay.parentElement?.children||[])].filter(element=>element!==overlay);
  if(bodyLockCount===0)originalBodyOverflow=document.body.style.overflow;
  bodyLockCount+=1;
  document.body.style.overflow='hidden';
  blocked.forEach(lockElement);

  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    blocked.forEach(unlockElement);
    bodyLockCount=Math.max(0,bodyLockCount-1);
    if(bodyLockCount===0)document.body.style.overflow=originalBodyOverflow;
  };
}
