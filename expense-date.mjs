const CALENDAR_DATE_PATTERN=/^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidExpenseDate(value){
  if(typeof value!=='string'||value.length!==10)return false;
  const match=CALENDAR_DATE_PATTERN.exec(value);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(year<1||month<1||month>12||day<1)return false;
  const leapYear=year%4===0&&(year%100!==0||year%400===0);
  return day<=[31,leapYear?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}

// 新增表單與舊客戶端共用台北日期，避免伺服器時區影響預設值
export function currentExpenseDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const part=type=>parts.find(item=>item.type===type).value;
  return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
}

export function resolveExpenseDate(value,{existingDate,now}={}){
  if(value===undefined)return existingDate===undefined?currentExpenseDate(now):resolveExpenseDate(existingDate);
  if(isValidExpenseDate(value))return value;
  const error=new Error('消費日期需為有效日期，格式為 YYYY-MM-DD');
  error.code='INVALID_EXPENSE_DATE';
  error.status=400;
  error.expose=true;
  throw error;
}

export function expenseCalendarDate(expense){
  if(isValidExpenseDate(expense?.expenseDate))return expense.expenseDate;
  if(!expense?.createdAt)return null;
  const createdAt=new Date(expense.createdAt);
  if(!Number.isFinite(createdAt.getTime()))return null;
  // 舊資料沒有消費日期時，保留原本建立時間在使用者當地的顯示方式
  return `${String(createdAt.getFullYear()).padStart(4,'0')}-${String(createdAt.getMonth()+1).padStart(2,'0')}-${String(createdAt.getDate()).padStart(2,'0')}`;
}

export function formatExpenseDate(expense,{short=false}={}){
  const date=expenseCalendarDate(expense);
  if(!date)return '日期未提供';
  const [year,month,day]=date.split('-').map(Number);
  return short?`${month}/${day}`:`${year}/${month}/${day}`;
}
