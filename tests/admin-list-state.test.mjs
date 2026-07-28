import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAdminItems,normalizeAdminQuery,paginateAdminItems} from '../src/admin-list-state.mjs';

test('管理者清單依各分頁的專屬欄位查詢',()=>{
  assert.equal(filterAdminItems('users',[{id:'user-1',displayName:'Kai',isSuperuser:true}],'管理者').length,1);
  assert.equal(filterAdminItems('simulations',[{id:'sim-1',displayName:'測試旅伴',note:'東京五人行',createdByName:'Kai'}],'東京').length,1);
  assert.equal(filterAdminItems('groups',[{id:'group-1',name:'賞櫻旅行',description:'河口湖',ownerName:'Andy'}],'河口湖').length,1);
  assert.equal(filterAdminItems('groups',[{id:'group-2',name:'首爾旅行',description:'',ownerName:'Andy',currency:'KRW'}],'krw').length,1);
  assert.equal(filterAdminItems('audit',[{action:'grant_superuser',actionLabel:'授予管理者權限',actorName:'Kai',targetType:'user',targetId:'user-2',metadata:{displayName:'Andy'}}],'授予管理者').length,1);
  const audit=[{action:'update_expense',actionLabel:'修改',actorName:'Kai',metadata:{groupName:'東京旅行',itemName:'築地早餐',changedFields:['名稱','金額']}}];
  assert.equal(filterAdminItems('audit',audit,'東京旅行').length,1);
  assert.equal(filterAdminItems('audit',audit,'築地早餐').length,1);
  assert.equal(filterAdminItems('audit',audit,'金額').length,1);
});

test('查詢會正規化全半形、大小寫與前後空白',()=>{
  assert.equal(normalizeAdminQuery('  ＴＲＩＰＴＡＢ  '),'triptab');
  const items=[{id:'user-1',displayName:'TripTab Admin',isSuperuser:true}];
  assert.equal(filterAdminItems('users',items,'  ｔｒｉｐｔａｂ ').length,1);
  assert.deepEqual(filterAdminItems('users',items,''),items);
  assert.notEqual(filterAdminItems('users',items,''),items);
});

test('分頁回傳正確範圍且不修改來源陣列',()=>{
  const source=Array.from({length:23},(_,index)=>index+1);
  const snapshot=[...source];
  const result=paginateAdminItems(source,2,10);
  assert.deepEqual(result.items,[11,12,13,14,15,16,17,18,19,20]);
  assert.deepEqual(source,snapshot);
  assert.deepEqual({page:result.page,totalPages:result.totalPages,start:result.start,end:result.end},{page:2,totalPages:3,start:11,end:20});
});

test('分頁會校正無效、超出範圍與空資料頁碼',()=>{
  const items=Array.from({length:23},(_,index)=>index+1);
  assert.equal(paginateAdminItems(items,0,10).page,1);
  assert.equal(paginateAdminItems(items,Number.NaN,10).page,1);
  assert.equal(paginateAdminItems(items,99,10).page,3);
  assert.deepEqual(paginateAdminItems([],9,10),{
    items:[],
    page:1,
    pageSize:10,
    totalItems:0,
    totalPages:1,
    start:0,
    end:0
  });
});
