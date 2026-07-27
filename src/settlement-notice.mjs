const safeText=value=>String(value||'').replace(/\s+/g,' ').trim();

export function formatSettlementReportTime(value){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '時間未記錄';
  const parts=new Intl.DateTimeFormat('zh-TW',{
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const part=type=>parts.find(item=>item.type===type)?.value||'';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

export function formatSettlementReportAmount(amountCents){
  const numeric=Number(amountCents);
  const safeCents=Number.isFinite(numeric)&&numeric>0?numeric:0;
  return `NT$ ${Math.round(safeCents/100).toLocaleString('zh-TW')}`;
}

export function buildSettlementNotice(report){
  const groupName=safeText(report?.groupName)||'未命名旅程';
  const payerName=safeText(report?.from?.displayName)||'付款人';
  const recipientName=safeText(report?.to?.displayName)||'收款人';
  const reporterName=safeText(report?.reportedBy?.displayName)||payerName;
  const amountLabel=formatSettlementReportAmount(report?.amountCents);
  const timeLabel=formatSettlementReportTime(report?.reportedAt);
  const reporterLine=reporterName===payerName?'':`\n回報人：${reporterName}`;

  return {
    amountLabel,
    timeLabel,
    text:`【旅帳 TripTab｜轉帳紀錄】
${reporterName} 已將這筆款項標記為「已轉帳」

旅程：${groupName}
付款人：${payerName}
收款人：${recipientName}
轉帳金額：${amountLabel}
記錄時間：${timeLabel}${reporterLine}

請 ${recipientName} 留意收款帳戶
旅帳僅記錄成員回報，實際入帳狀態以銀行紀錄為準`
  };
}

export function settlementLineShareUrl(report){
  return `https://line.me/R/share?text=${encodeURIComponent(buildSettlementNotice(report).text)}`;
}
