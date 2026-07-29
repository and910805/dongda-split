const readableName=(value,fallback)=>String(value??'').trim()||fallback;
const isEnglish=options=>String(options?.language||'').toLowerCase().startsWith('en');

export function expenseDeletionConfirmation(title,options={}){
  const english=isEnglish(options);
  const expenseTitle=readableName(title,english?'Unnamed expense':'未命名支出');
  return {
    title:english?`Delete “${expenseTitle}”?`:`刪除「${expenseTitle}」？`,
    description:english
      ?'This expense and its splits will be removed from the ledger. This cannot be undone.'
      :'刪除後，這筆支出與相關分攤會從帳本移除，且無法復原',
    confirmLabel:english?'Delete expense':'刪除支出',
    tone:'danger'
  };
}

export function groupDeletionConfirmation(name,options={}){
  const english=isEnglish(options);
  const groupName=readableName(name,english?'Unnamed group':'未命名群組');
  return {
    title:english?`Delete group “${groupName}”?`:`刪除群組「${groupName}」？`,
    description:english
      ?'All expenses, splits, and settlement records in this group will be deleted. This cannot be undone.'
      :'群組內的所有支出、分攤與結算紀錄都會一併刪除，且無法復原',
    confirmLabel:english?'Delete group':'刪除群組',
    tone:'danger'
  };
}

export function bankAccountRemovalConfirmation(options={}){
  const english=isEnglish(options);
  return {
    title:english?'Remove saved receiving account?':'移除常用收款帳戶？',
    description:english
      ?'Members who owe you will no longer be able to view these transfer details. You can set them up again later.'
      :'移除後，目前欠你款項的成員將無法查看這組轉帳資訊，你可以之後重新設定',
    confirmLabel:english?'Remove account':'移除帳戶',
    tone:'danger'
  };
}

export function settlementVoidConfirmation(settlement,options={}){
  const english=isEnglish(options);
  const fromName=readableName(settlement?.from?.displayName,english?'Payer':'付款人');
  const toName=readableName(settlement?.to?.displayName,english?'Recipient':'收款人');
  return {
    title:english?`Void the transfer report for “${fromName} → ${toName}”?`:`撤銷「${fromName} → ${toName}」的轉帳回報？`,
    description:english
      ?'TripTab will recalculate the group balances, but it will not cancel any transfer already completed through a bank or other payment service.'
      :'撤銷後，TripTab 會重新計算群組結餘，但不會取消銀行或其他支付工具中已完成的實際轉帳',
    confirmLabel:english?'Void report':'撤銷回報',
    tone:'danger'
  };
}

export function roleChangeConfirmation(user,options={}){
  const english=isEnglish(options);
  const displayName=readableName(user?.displayName,english?'Unnamed user':'未命名使用者');
  if(user?.isSuperuser){
    return {
      title:english?`Remove administrator access from “${displayName}”?`:`移除「${displayName}」的管理權限？`,
      description:english
        ?'This account will immediately lose access to the administration center and cross-group views. Regular expense data will not be affected.'
        :'此帳號將立即失去管理者中心與跨群組查看權限，一般分帳資料不受影響',
      confirmLabel:english?'Remove administrator access':'移除管理權限',
      tone:'danger',
      nextValue:false,
      action:english?'removed administrator access':'移除管理者權限'
    };
  }
  return {
    title:english?`Make “${displayName}” an administrator?`:`將「${displayName}」設為管理者？`,
    description:english
      ?'Administrators can view users, groups, and audit data across the service and use account simulation. Make sure you trust this account.'
      :'管理者可以查看全站使用者、群組與稽核資料，並操作帳戶模擬，請確認你信任此帳號',
    confirmLabel:english?'Grant administrator access':'授予管理權限',
    tone:'primary',
    nextValue:true,
    action:english?'granted administrator access':'授予管理者權限'
  };
}
