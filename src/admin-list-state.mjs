export const ADMIN_TABS=Object.freeze(['users','simulations','groups','audit']);

function flattenSearchValues(value){
  if(value===null||value===undefined)return[];
  if(Array.isArray(value))return value.flatMap(flattenSearchValues);
  if(typeof value==='object')return Object.values(value).flatMap(flattenSearchValues);
  return[value];
}

const searchableValues={
  users:item=>[
    item?.displayName,
    item?.id,
    item?.isSuperuser?'管理者':'一般使用者'
  ],
  simulations:item=>[
    item?.displayName,
    item?.id,
    item?.note,
    item?.createdByName
  ],
  groups:item=>[
    item?.name,
    item?.id,
    item?.description,
    item?.ownerName
  ],
  audit:item=>[
    item?.actionLabel,
    item?.action,
    item?.actorName,
    item?.targetType,
    item?.targetId,
    item?.summary,
    item?.detail,
    ...flattenSearchValues(item?.metadata)
  ]
};

export function normalizeAdminQuery(value){
  return String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

export function filterAdminItems(tab,items,query){
  const normalizedQuery=normalizeAdminQuery(query);
  if(!normalizedQuery)return [...items];
  const selectValues=searchableValues[tab]||(()=>[]);
  return items.filter(item=>selectValues(item)
    .filter(value=>value!==null&&value!==undefined)
    .map(value=>normalizeAdminQuery(value))
    .some(value=>value.includes(normalizedQuery)));
}

export function paginateAdminItems(items,page,pageSize){
  const safePageSize=Math.max(1,Math.floor(Number(pageSize)||1));
  const totalItems=items.length;
  const totalPages=Math.max(1,Math.ceil(totalItems/safePageSize));
  const requestedPage=Math.floor(Number(page));
  const safePage=Math.min(Math.max(Number.isFinite(requestedPage)?requestedPage:1,1),totalPages);
  const offset=(safePage-1)*safePageSize;
  const pageItems=items.slice(offset,offset+safePageSize);
  return {
    items:pageItems,
    page:safePage,
    pageSize:safePageSize,
    totalItems,
    totalPages,
    start:totalItems?offset+1:0,
    end:totalItems?offset+pageItems.length:0
  };
}
