const readableName=(value,fallback)=>String(value??'').trim()||fallback;

export function expenseDeletionConfirmation(title){
  const expenseTitle=readableName(title,'未命名支出');
  return {
    title:`刪除「${expenseTitle}」？`,
    description:'刪除後，這筆支出與相關分攤會從帳本移除，且無法復原',
    confirmLabel:'刪除支出',
    tone:'danger'
  };
}

export function groupDeletionConfirmation(name){
  const groupName=readableName(name,'未命名群組');
  return {
    title:`刪除群組「${groupName}」？`,
    description:'群組內的所有支出、分攤與結算紀錄都會一併刪除，且無法復原',
    confirmLabel:'刪除群組',
    tone:'danger'
  };
}

export function bankAccountRemovalConfirmation(){
  return {
    title:'移除常用收款帳戶？',
    description:'移除後，目前欠你款項的成員將無法查看這組轉帳資訊，你可以之後重新設定',
    confirmLabel:'移除帳戶',
    tone:'danger'
  };
}

export function roleChangeConfirmation(user){
  const displayName=readableName(user?.displayName,'未命名使用者');
  if(user?.isSuperuser){
    return {
      title:`移除「${displayName}」的管理權限？`,
      description:'此帳號將立即失去管理者中心與跨群組查看權限，一般分帳資料不受影響',
      confirmLabel:'移除管理權限',
      tone:'danger',
      nextValue:false,
      action:'移除管理者權限'
    };
  }
  return {
    title:`將「${displayName}」設為管理者？`,
    description:'管理者可以查看全站使用者、群組與稽核資料，並操作帳戶模擬，請確認你信任此帳號',
    confirmLabel:'授予管理權限',
    tone:'primary',
    nextValue:true,
    action:'授予管理者權限'
  };
}
