import {formatCurrencyAmount,isSupportedCurrency} from '../currency.mjs';

const actionDefinitions=Object.freeze({
  create_group:{label:'新增',tone:'create'},
  join_group:{label:'加入',tone:'join'},
  delete_group:{label:'刪除',tone:'delete'},
  create_expense:{label:'新增',tone:'create'},
  update_expense:{label:'修改',tone:'update'},
  delete_expense:{label:'刪除',tone:'delete'},
  report_settlement:{label:'回報',tone:'settlement'},
  void_settlement:{label:'撤銷',tone:'delete'},
  convert_group_currency:{label:'換算',tone:'update'},
  sync_exchange_rates:{label:'同步',tone:'system'},
  grant_superuser:{label:'授權',tone:'update'},
  revoke_superuser:{label:'移除',tone:'delete'},
  create_simulated_account:{label:'建立',tone:'create'},
  start_account_simulation:{label:'開始',tone:'system'},
  end_account_simulation:{label:'結束',tone:'system'},
  simulation_action:{label:'操作',tone:'system'}
});

const safeText=(value,fallback='')=>{
  const normalized=String(value??'').trim();
  return normalized||fallback;
};

export function formatAuditAmount(cents,currency='TWD'){
  const value=Number(cents);
  if(!Number.isFinite(value))return '';
  const code=isSupportedCurrency(currency)?String(currency).toUpperCase():'TWD';
  return formatCurrencyAmount(value,code);
}

export function presentAuditItem(item){
  const metadata=item?.metadata||{};
  const action=safeText(item?.action,'unknown');
  const definition=actionDefinitions[action]||{label:'操作',tone:'system'};
  const actorName=safeText(item?.actorName,'未知使用者');
  const groupName=safeText(metadata.groupName);
  const itemName=safeText(metadata.itemName||metadata.title||metadata.displayName);
  const itemType=safeText(metadata.itemType);
  const quoted=value=>`「${value}」`;
  let summary;

  switch(action){
    case 'create_group':
      summary=`${actorName} 建立群組${itemName?quoted(itemName):''}`;
      break;
    case 'join_group':
      summary=`${actorName} 加入群組${groupName?quoted(groupName):''}`;
      break;
    case 'delete_group':
      summary=`${actorName} 刪除群組${itemName?quoted(itemName):''}`;
      break;
    case 'create_expense':
      summary=`${actorName}${groupName?` 在${quoted(groupName)}`:''}新增支出${itemName?quoted(itemName):''}`;
      break;
    case 'update_expense':
      summary=`${actorName}${groupName?` 在${quoted(groupName)}`:''}修改支出${itemName?quoted(itemName):''}`;
      break;
    case 'delete_expense':
      summary=`${actorName}${groupName?` 在${quoted(groupName)}`:''}刪除支出${itemName?quoted(itemName):''}`;
      break;
    case 'report_settlement':
      summary=`${actorName}${groupName?` 在${quoted(groupName)}`:''}回報轉帳${itemName?quoted(itemName):''}`;
      break;
    case 'void_settlement':
      summary=`${actorName}${groupName?` 在${quoted(groupName)}`:''}撤銷轉帳回報${itemName?quoted(itemName):''}`;
      break;
    case 'convert_group_currency':
      summary=`${actorName}${groupName?` 將${quoted(groupName)}`:' 將群組'}幣別由 ${safeText(metadata.fromCurrency,'—')} 變更為 ${safeText(metadata.toCurrency,'—')}`;
      break;
    case 'sync_exchange_rates':
      summary=`${actorName} 手動同步每日匯率`;
      break;
    case 'grant_superuser':
      summary=`${actorName} 授予${itemName?quoted(itemName):'使用者'}管理者權限`;
      break;
    case 'revoke_superuser':
      summary=`${actorName} 移除${itemName?quoted(itemName):'使用者'}管理者權限`;
      break;
    case 'create_simulated_account':
      summary=`${actorName} 建立模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'start_account_simulation':
      summary=`${actorName} 開始模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'end_account_simulation':
      summary=`${actorName} 結束模擬帳號${itemName?quoted(itemName):''}`;
      break;
    case 'simulation_action':
      summary=`${actorName} 以模擬帳號${itemName?quoted(itemName):''}執行操作`;
      break;
    default:
      summary=`${actorName} 執行 ${action}`;
  }

  const detailParts=[];
  const amount=formatAuditAmount(metadata.amountCents,metadata.currency);
  if(amount)detailParts.push(amount);
  if(action==='convert_group_currency'&&metadata.rate){
    detailParts.push(`匯率 ${safeText(metadata.rate)} · ${safeText(metadata.rateDate,'日期未記錄')}`);
  }
  if(Array.isArray(metadata.changedFields)&&metadata.changedFields.length){
    detailParts.push(`修改：${metadata.changedFields.map(value=>safeText(value)).filter(Boolean).join('、')}`);
  }else if(itemType&&itemName&&!summary.includes(itemName)){
    detailParts.push(`${itemType}：${itemName}`);
  }
  if(metadata.actedAsName)detailParts.push(`模擬身分：${safeText(metadata.actedAsName)}`);

  return {
    ...item,
    actionLabel:definition.label,
    actionTone:definition.tone,
    summary,
    detail:detailParts.join(' · '),
    groupName,
    itemName,
    itemType
  };
}
