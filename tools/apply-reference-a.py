from pathlib import Path
import hashlib
def blob(data):
 return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
p=Path('src/ProductApp.jsx');s=p.read_text()
assert blob(p.read_bytes()) == '33223d9f1056e268010ca7bc96d5f725e99511c9'
def sub(a,b):
 global s
 assert s.count(a)==1,(s.count(a),a[:120]);s=s.replace(a,b)
sub("import {AdvancedExpenseModal}","import {LedgerExpenseActions} from './LedgerExpenseActions.jsx';\nimport {AdvancedExpenseModal}")
sub("DEFAULT_EXPENSE_SORT,filterExpenses,nextExpenseSort,sortExpenses}","DEFAULT_EXPENSE_SORT,expenseDateOptions,filterExpenses,filterExpensesByDate,nextExpenseSort,sortExpenses}")
# Keep all existing account and workspace controls, but remove the redundant header identity on desktop via CSS.
sub('<div className="group-switcher">{groups.map(item=><button', '<div className="group-switcher">{groups.map((item,index)=><button')
sub('onClick={()=>selectGroup(item.id)}><div>', 'onClick={()=>selectGroup(item.id)}><span className={`ledger-cover cover-${index%4}`} aria-hidden="true"/><div>')
sub("const [mobileNavActive,setMobileNavActive]=useState('overview');", "const [mobileNavActive,setMobileNavActive]=useState('overview');\n  const [expenseDateFilter,setExpenseDateFilter]=useState('all');\n  const availableExpenseDates=useMemo(()=>expenseDateOptions(group.expenses),[group.expenses]);")
sub("const visibleExpenses=useMemo(()=>filterExpenses(memberFilteredExpenses,deferredExpenseQuery),[deferredExpenseQuery,memberFilteredExpenses]);", "const visibleExpenses=useMemo(()=>filterExpenses(filterExpensesByDate(memberFilteredExpenses,expenseDateFilter),deferredExpenseQuery),[deferredExpenseQuery,memberFilteredExpenses,expenseDateFilter]);")
sub("const expenseFiltersActive=expenseMemberId!=='all'||expenseSearchActive;", "const expenseFiltersActive=expenseMemberId!=='all'||expenseSearchActive||expenseDateFilter!=='all';")
sub("const openAllExpenses=()=>{setExpenseMemberId('all');", "const openAllExpenses=()=>{setExpenseDateFilter('all');setExpenseMemberId('all');")
# Put settings immediately after the ledger identity, not in the artwork's action area.
a=s.index('        <div className="group-overview-side">');b=s.index('        <div className="group-overview-copy">',a)
settings=s[a:b].strip()
s=s[:a]+s[b:]
sub('<span className="currency-badge">{currencyCode}</span></div>', '<span className="currency-badge">{currencyCode}</span>'+settings+'</div>')
sub("<p>{group.description||'一起記下每筆共同花費，最後輕鬆結清'}</p>","<p>{group.description||'一起記下每筆共同花費，最後輕鬆結清'}</p>\n          <p className=\"ledger-travel-note\">山海相伴，旅途的每一刻，都值得被好好記錄</p>")
# A member strip should never overflow into artwork or require horizontal hunting.
sub('{expenseMembers.map(member=><li key={member.id}><button type="button" className="group-member-avatar"', '{expenseMembers.slice(0,12).map(member=><li key={member.id}><button type="button" className="group-member-avatar"')
sub('            </ul>\n          </div>\n          <div className="mobile-group-details">', '              {expenseMembers.length>12&&<li><button type="button" className="group-member-avatar ledger-members-more" aria-label={`查看其餘 ${expenseMembers.length-12} 位成員`} aria-haspopup="dialog" onClick={()=>setShowMobileTools(true)}>+{expenseMembers.length-12}</button></li>}\n            </ul>\n          </div>\n          <div className="mobile-group-details">')
# Remove the extra shortcut block; each action has an explicit, contextual home.
a=s.index('      <div className={`mobile-shortcuts ');b=s.index('\n    </div>\n    <div className="real-grid">',a);s=s[:a]+s[b:]
# Card copy uses real state and never promises every ledger is settled.
sub('<small>待結算</small><h3>{group.settlements.length} 筆</h3></div>', '<small>待結算</small><h3>{group.settlements.length} 筆</h3><p>{!group.expenses.length?\'從第一筆花費開始\':group.settlements.length?\'查看右側結算明細\':\'目前沒有待結算款項\'}</p></div>')
sub('<small>同行成員</small><h3>{memberCount} 位</h3></div>', '<small>同行成員</small><h3>{memberCount} 位</h3><p>一起創造了珍貴的回憶</p></div>')
# Date filter lives with other list filters, never affects ledger totals.
sub('              <label className="expense-member-filter"', '''              <label className="expense-date-filter"><span className="sr-only">依消費日期篩選</span><Clock3 aria-hidden="true"/><select aria-label="依消費日期篩選" value={expenseDateFilter} onChange={event=>{setExpenseDateFilter(event.target.value);setExpensePage(1)}}><option value="all">全部日期</option>{expenseDateFilter!=='all'&&!availableExpenseDates.includes(expenseDateFilter)&&<option value={expenseDateFilter}>{expenseDateFilter}</option>}{availableExpenseDates.map(date=><option key={date} value={date}>{date.replaceAll('-','/')}</option>)}</select><ChevronDown aria-hidden="true"/></label>
              <label className="expense-member-filter"''')
sub("placeholder=\"搜尋項目\"", "placeholder=\"搜尋項目、付款人或分類\"")
# Keep a truthful label for a date-specific empty result.
sub(":'目前沒有符合篩選條件的支出'}</p></div>", ":'目前沒有符合篩選條件的支出'}</p><button type=\"button\" className=\"empty-primary\" onClick={openAllExpenses}>清除篩選</button></div>")
a=s.index('                <div className="expense-row-actions" role="cell">');b=s.index('\n                <MobileExpenseRecord ',a)
s=s[:a]+'''                <div className="expense-row-actions" role="cell"><LedgerExpenseActions expense={e} canManage={e.createdBy===me.id||group.ownerId===me.id||me.isSuperuser} busy={deleting===e.id} onDetails={setSelectedExpenseShares} onEdit={editExpense} onDelete={requestRemoveExpense}/></div>'''+s[b:]
# Balance access next to settlement, retained both desktop and mobile.
sub('<button className="settlement-help-button" onClick={()=>setShowSettlementHelp(true)} aria-label="了解結算演算法"><CircleHelp/></button></div>', '<button type="button" className="settlement-balances shortcut-balances" onClick={()=>setShowBalances(true)}>成員應收應付<ArrowRight aria-hidden="true"/></button></div>')
sub('{activeRepayments.length>0&&<button type="button" className="settlement-repayment-note" onClick={openRepaymentHistory}><span>結餘已計入 {activeRepayments.length} 筆有效還款（共 {groupMoney(activeRepaymentTotal)}）</span><b>查看紀錄</b></button>}', '{activeRepayments.length>0&&<p className="settlement-repayment-note sr-only">結餘已計入 {activeRepayments.length} 筆有效還款（共 {groupMoney(activeRepaymentTotal)}），可於還款紀錄頁籤查看</p>}')
sub('      </aside>\n    </div>\n    <nav className="mobile-bottom-nav"', '        <button type="button" className="settlement-help-button" onClick={()=>setShowSettlementHelp(true)}><CircleHelp aria-hidden="true"/>結算說明</button>\n      </aside>\n    </div>\n    <nav className="mobile-bottom-nav"')
sub("selectedExpenseMember?`${selectedExpenseMember.displayName} 尚未參與任何支出`", "expenseDateFilter!=='all'?'這個日期沒有符合的支出':selectedExpenseMember?`${selectedExpenseMember.displayName} 尚未參與任何支出`")
assert blob(s.encode()) == '19608b73b5de6c7df27c55f92d03946b46d7b48c'
p.write_text(s)
print('ProductApp bytes',len(s.encode()))

p=Path('src/ledger-coastal.css');s=p.read_text()
assert blob(p.read_bytes()) == 'f594e0e0a52594404a45d966d673611a67a904b6'
sub('  width: 224px; padding: 20px 16px 25px; background: #fffefa;\n', '  width: 244px; padding: 20px 16px 25px; background: #fffefa;\n')
sub('.real-app:has(.real-dashboard) .real-workspace { position: relative; margin-left: 224px; width: calc(100% - 224px); background: var(--coast-bg); min-height: 100vh; }\n', '.real-app:has(.real-dashboard) .real-workspace { position: relative; margin-left: 244px; width: calc(100% - 244px); background: var(--coast-bg); min-height: 100vh; }\n')
sub("  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 560px;\n", "  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 430px;\n")
sub('  mask-image: linear-gradient(#000 0%, #000 53%, transparent 76%);\n', '  mask-image: linear-gradient(#000 0%, #000 72%, transparent 91%);\n')
sub('  position: relative; top: auto; height: 82px; padding: 10px 32px; border: 0; background: transparent; box-shadow: none;\n', '  position: relative; top: auto; height: 70px; padding: 10px 32px; border: 0; background: transparent; box-shadow: none;\n')
sub('.real-app:has(.real-dashboard) .real-dashboard { position: relative; width: 100%; max-width: none; margin: 0; padding: 22px 32px 50px; }\n', '.real-app:has(.real-dashboard) .real-dashboard { position: relative; width: 100%; max-width: none; margin: 0; padding: 8px 28px 50px; }\n')
sub('  height: auto; min-height: 230px; margin: 0 0 27px; padding: 25px 0 0; overflow: visible;\n', '  height: auto; min-height: 239px; margin: 0 0 27px; padding: 4px 19px 0; overflow: visible;\n')
sub('.real-app:has(.real-dashboard) .group-hero h1 { max-width: min(630px, 70%); margin: 0; color: var(--coast-ink); font-size: clamp(30px, 2.9vw, 48px); font-weight: 800; line-height: 1.25; letter-spacing: -.045em; overflow-wrap: anywhere; }\n', '.real-app:has(.real-dashboard) .group-hero h1 { max-width: min(630px, 70%); margin: 0; color: var(--coast-ink); font-size: clamp(30px, 2.9vw, 44px); font-weight: 800; line-height: 1.25; letter-spacing: -.045em; overflow-wrap: anywhere; }\n')
sub('.real-app:has(.real-dashboard) .group-overview-side { position: absolute; right: 0; top: -13px; padding: 0; width: auto; }\n', '.real-app:has(.real-dashboard) .group-overview-side { position: relative; inset: auto; padding: 0; width: auto; margin-left: clamp(16px, 6vw, 100px); flex: none; }\n')
sub('.real-app:has(.real-dashboard) .group-admin-menu summary { min-height: 48px; padding: 0 17px; border-radius: 9px; background: #fffefbf7; border: 1px solid #dce4db; color: #213f3a; font-size: 13px; }\n', '.real-app:has(.real-dashboard) .group-admin-menu summary { min-height: 44px; padding: 0 17px; border-radius: 9px; background: #fffefbf7; border: 1px solid #dce4db; color: #213f3a; font-size: 13px; }\n')
sub('.real-app:has(.real-dashboard) .real-stats .stat-card { display: flex; align-items: center; gap: 16px; padding: 18px 19px; min-height: 116px; border: 1px solid #ffffffd9; background: #fffefaed; border-radius: 15px; box-shadow: 0 4px 20px #30403003; color: var(--coast-ink); }\n', '.real-app:has(.real-dashboard) .real-stats .stat-card { display: flex; align-items: center; gap: 16px; padding: 18px 19px; min-height: 111px; border: 1px solid #ffffffd9; background: #fffefaed; border-radius: 15px; box-shadow: 0 4px 20px #30403003; color: var(--coast-ink); }\n')
sub('.real-app:has(.real-dashboard) .real-stats .balance-stat::before { display: grid; place-items: center; width: 56px; height: 56px; flex: none; background: #e7f3e9; color: #147b55; border: 0; border-radius: 50%; margin: 0; }\n', '.real-app:has(.real-dashboard) .real-stats .balance-stat::before { display: grid; place-items: center; width: 68px; height: 68px; flex: none; background: #e7f3e9; color: #147b55; border: 0; border-radius: 50%; margin: 0; }\n')
sub('.real-app:has(.real-dashboard) .real-grid { display: grid; grid-template-columns: minmax(0, 1.68fr) minmax(330px, 1fr); gap: 16px; align-items: start; }\n', '.real-app:has(.real-dashboard) .real-grid { display: grid; grid-template-columns: minmax(0, 1.80fr) minmax(330px, 1fr); gap: 16px; align-items: start; }\n')
sub('.real-app:has(.real-dashboard) .activity-tabs { display: flex; align-items: stretch; height: 72px; padding: 0 20px; margin: 0; gap: 0; border: 0; border-bottom: 1px solid #edf0e9; border-radius: 0; background: #f5f8f1b0; box-shadow: none; }\n', '.real-app:has(.real-dashboard) .activity-tabs { display: flex; align-items: stretch; height: 62px; padding: 0 16px; margin: 0; gap: 0; border: 0; border-bottom: 1px solid #edf0e9; border-radius: 0; background: #f5f8f1b0; box-shadow: none; }\n')
sub('.real-app:has(.real-dashboard) .activity-tabs button { position: relative; display: flex; flex: 1; align-items: center; justify-content: center; gap: 11px; min-height: 58px; margin: 0; padding: 0 16px; border: 0; border-radius: 0; background: transparent; color: #81918a; box-shadow: none; font-size: 15px; font-weight: 650; }\n', '.real-app:has(.real-dashboard) .activity-tabs button { position: relative; display: flex; flex: none; align-items: center; justify-content: center; gap: 11px; min-height: 58px; margin: 0; padding: 0 16px; border: 0; border-radius: 0; background: transparent; color: #81918a; box-shadow: none; font-size: 15px; font-weight: 650; }\n')
sub('.real-app:has(.real-dashboard) .expense-panel > .section-head { display: block; padding: 14px 18px; min-height: 79px; border: 0; }\n', '.real-app:has(.real-dashboard) .expense-panel > .section-head { display: block; padding: 10px 14px; min-height: 60px; border: 0; }\n')
sub('.real-app:has(.real-dashboard) .record-list > article { display: grid; grid-template-columns: 80px minmax(92px, 1fr) 74px 85px 104px 50px 73px 105px; align-items: center; gap: 10px; padding: 12px 19px; min-width: 765px; }\n', '.real-app:has(.real-dashboard) .record-list > article { display: grid; grid-template-columns: 84px minmax(112px, 1fr) 76px 86px 104px 68px 76px 40px; align-items: center; gap: 10px; padding: 12px 19px; min-width: 765px; }\n')
assert blob(s.encode()) == 'bcc041403002c2f628b68c09309d8e20394710b9'
p.write_text(s)
