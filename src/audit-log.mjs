import {formatCurrencyAmount,isSupportedCurrency} from '../currency.mjs';

const actionDefinitions=Object.freeze({
  create_group:{label:{zh:'新增',en:'Created'},tone:'create'},
  join_group:{label:{zh:'加入',en:'Joined'},tone:'join'},
  delete_group:{label:{zh:'刪除',en:'Deleted'},tone:'delete'},
  create_expense:{label:{zh:'新增',en:'Added'},tone:'create'},
  update_expense:{label:{zh:'修改',en:'Updated'},tone:'update'},
  delete_expense:{label:{zh:'刪除',en:'Deleted'},tone:'delete'},
  report_settlement:{label:{zh:'回報',en:'Reported'},tone:'settlement'},
  void_settlement:{label:{zh:'撤銷',en:'Voided'},tone:'delete'},
  convert_group_currency:{label:{zh:'換算',en:'Converted'},tone:'update'},
  sync_exchange_rates:{label:{zh:'同步',en:'Synced'},tone:'system'},
  grant_superuser:{label:{zh:'授權',en:'Granted'},tone:'update'},
  revoke_superuser:{label:{zh:'移除',en:'Removed'},tone:'delete'},
  create_simulated_account:{label:{zh:'建立',en:'Created'},tone:'create'},
  start_account_simulation:{label:{zh:'開始',en:'Started'},tone:'system'},
  end_account_simulation:{label:{zh:'結束',en:'Ended'},tone:'system'},
  simulation_action:{label:{zh:'操作',en:'Action'},tone:'system'}
});

const safeText=(value,fallback='')=>{
  const normalized=String(value??'').trim();
  return normalized||fallback;
};
const isEnglish=options=>String(options?.language||'').toLowerCase().startsWith('en');
const legacyItemTypeTranslations=Object.freeze({
  群組:'Group',
  成員:'Member',
  群組幣別:'Group currency',
  支出:'Expense',
  轉帳:'Transfer'
});
const legacyChangedFieldTranslations=Object.freeze({
  名稱:'Name',
  金額:'Amount',
  分類:'Category',
  分攤方式:'Split method',
  付款與分攤:'Payments and splits'
});

export function formatAuditAmount(cents,currency='TWD',_options={}){
  const value=Number(cents);
  if(!Number.isFinite(value))return '';
  const code=isSupportedCurrency(currency)?String(currency).toUpperCase():'TWD';
  return formatCurrencyAmount(value,code);
}

export function presentAuditItem(item,options={}){
  const english=isEnglish(options);
  const metadata=item?.metadata||{};
  const action=safeText(item?.action,'unknown');
  const definition=actionDefinitions[action]||{label:{zh:'操作',en:'Action'},tone:'system'};
  const actorName=safeText(item?.actorName,english?'Unknown user':'未知使用者');
  const groupName=safeText(metadata.groupName);
  const itemName=safeText(metadata.itemName||metadata.title||metadata.displayName);
  const rawItemType=safeText(metadata.itemType);
  const itemType=english?(legacyItemTypeTranslations[rawItemType]||rawItemType):rawItemType;
  const quoted=value=>english?`“${value}”`:`「${value}」`;
  let summary;

  switch(action){
    case 'create_group':
      summary=english
        ?`${actorName} created group${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 建立群組${itemName?quoted(itemName):''}`;
      break;
    case 'join_group':
      summary=english
        ?`${actorName} joined group${groupName?` ${quoted(groupName)}`:''}`
        :`${actorName} 加入群組${groupName?quoted(groupName):''}`;
      break;
    case 'delete_group':
      summary=english
        ?`${actorName} deleted group${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 刪除群組${itemName?quoted(itemName):''}`;
      break;
    case 'create_expense':
      summary=english
        ?`${actorName} added expense${itemName?` ${quoted(itemName)}`:''}${groupName?` in ${quoted(groupName)}`:''}`
        :`${actorName}${groupName?` 在${quoted(groupName)}`:''}新增支出${itemName?quoted(itemName):''}`;
      break;
    case 'update_expense':
      summary=english
        ?`${actorName} updated expense${itemName?` ${quoted(itemName)}`:''}${groupName?` in ${quoted(groupName)}`:''}`
        :`${actorName}${groupName?` 在${quoted(groupName)}`:''}修改支出${itemName?quoted(itemName):''}`;
      break;
    case 'delete_expense':
      summary=english
        ?`${actorName} deleted expense${itemName?` ${quoted(itemName)}`:''}${groupName?` in ${quoted(groupName)}`:''}`
        :`${actorName}${groupName?` 在${quoted(groupName)}`:''}刪除支出${itemName?quoted(itemName):''}`;
      break;
    case 'report_settlement':
      summary=english
        ?`${actorName} reported transfer${itemName?` ${quoted(itemName)}`:''}${groupName?` in ${quoted(groupName)}`:''}`
        :`${actorName}${groupName?` 在${quoted(groupName)}`:''}回報轉帳${itemName?quoted(itemName):''}`;
      break;
    case 'void_settlement':
      summary=english
        ?`${actorName} voided transfer report${itemName?` ${quoted(itemName)}`:''}${groupName?` in ${quoted(groupName)}`:''}`
        :`${actorName}${groupName?` 在${quoted(groupName)}`:''}撤銷轉帳回報${itemName?quoted(itemName):''}`;
      break;
    case 'convert_group_currency':
      summary=english
        ?`${actorName} changed ${groupName?`${quoted(groupName)} `:'group '}currency from ${safeText(metadata.fromCurrency,'—')} to ${safeText(metadata.toCurrency,'—')}`
        :`${actorName}${groupName?` 將${quoted(groupName)}`:' 將群組'}幣別由 ${safeText(metadata.fromCurrency,'—')} 變更為 ${safeText(metadata.toCurrency,'—')}`;
      break;
    case 'sync_exchange_rates':
      summary=english?`${actorName} manually synced daily exchange rates`:`${actorName} 手動同步每日匯率`;
      break;
    case 'grant_superuser':
      summary=english
        ?`${actorName} granted administrator access to ${itemName?quoted(itemName):'a user'}`
        :`${actorName} 授予${itemName?quoted(itemName):'使用者'}管理者權限`;
      break;
    case 'revoke_superuser':
      summary=english
        ?`${actorName} removed administrator access from ${itemName?quoted(itemName):'a user'}`
        :`${actorName} 移除${itemName?quoted(itemName):'使用者'}管理者權限`;
      break;
    case 'create_simulated_account':
      summary=english
        ?`${actorName} created simulated account${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 建立模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'start_account_simulation':
      summary=english
        ?`${actorName} started simulating account${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 開始模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'end_account_simulation':
      summary=english
        ?`${actorName} stopped simulating account${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 結束模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'simulation_action':
      summary=english
        ?`${actorName} performed an action as simulated account${itemName?` ${quoted(itemName)}`:''}`
        :`${actorName} 以模擬帳號${itemName?quoted(itemName):''}執行操作`;
      break;
    default:
      summary=english?`${actorName} performed ${action}`:`${actorName} 執行 ${action}`;
  }

  const detailParts=[];
  const amount=formatAuditAmount(metadata.amountCents,metadata.currency,options);
  if(amount)detailParts.push(amount);
  if(action==='convert_group_currency'&&metadata.rate){
    detailParts.push(english
      ?`Rate ${safeText(metadata.rate)} · ${safeText(metadata.rateDate,'Date not recorded')}`
      :`匯率 ${safeText(metadata.rate)} · ${safeText(metadata.rateDate,'日期未記錄')}`);
  }
  if(Array.isArray(metadata.changedFields)&&metadata.changedFields.length){
    const changedFields=metadata.changedFields.map(value=>safeText(value)).filter(Boolean);
    detailParts.push(english
      ?`Changed: ${changedFields.map(value=>legacyChangedFieldTranslations[value]||value).join(', ')}`
      :`修改：${changedFields.join('、')}`);
  }else if(itemType&&itemName&&!summary.includes(itemName)){
    detailParts.push(`${itemType}${english?': ':'：'}${itemName}`);
  }
  if(metadata.actedAsName)detailParts.push(english
    ?`Simulated identity: ${safeText(metadata.actedAsName)}`
    :`模擬身分：${safeText(metadata.actedAsName)}`);

  return {
    ...item,
    actionLabel:english?definition.label.en:definition.label.zh,
    actionTone:definition.tone,
    summary,
    detail:detailParts.join(' · '),
    groupName,
    itemName,
    itemType
  };
}
