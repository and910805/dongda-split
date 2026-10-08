// Public marketing preview only: synthetic people and expenses, no real account data.
// Reuse the production allocation functions so the amounts and balances agree.
import {allocateEqual, minimizeSettlements} from '../../finance.mjs';

export function createHomeLedgerFixture() {
  const names = ['小安', '阿哲', '晴晴', '阿岑', '浩然', '承恩', '小萱', '品妤', '柏宇', '宥廷', '子晴', '雅涵', '小恩', '阿凱', '怡君'];
  const members = names.map((displayName, i) => ({id: `demo-member-${i + 1}`, displayName}));
  const ids = members.map(member => member.id);
  const examples = [
    ['麻古', '餐飲', 90, 1, ids.slice(0, 2)],
    ['午餐', '餐飲', 10440, 2, ids.slice(0, 14)],
    ['蔥油餅', '餐飲', 450, 3, ids.slice(0, 10)],
  ];
  const expenses = examples.map(([title, category, amount, payerIndex, participants], i) => {
    const amountCents = amount * 100;
    const payer = members[payerIndex];
    return {
      id: `demo-expense-${i + 1}`, title, category, amountCents,
      payerId: payer.id, payerName: payer.displayName, payerCount: 1,
      shareCount: participants.length, splitMode: 'equal', createdBy: payer.id,
      expenseDate: '2026-07-26', createdAt: `2026-07-26T${String(16 - i).padStart(2, '0')}:00:00Z`,
      isLocked: false,
      shares: allocateEqual(amountCents, participants, false).map(({userId, shareCents}) => ({userId, amountCents: shareCents})),
      payments: [{userId: payer.id, amountCents}],
    };
  });
  const balances = members.map(member => ({...member, balanceCents: expenses.reduce((total, expense) => total
    + expense.payments.filter(payment => payment.userId === member.id).reduce((sum, payment) => sum + payment.amountCents, 0)
    - expense.shares.filter(share => share.userId === member.id).reduce((sum, share) => sum + share.amountCents, 0), 0)}));
  return {
    id: 'demo-yilan', name: '宜筆勾銷', description: '一起記下每筆共同花費，最後輕鬆結清',
    currency: 'TWD', ledgerVersion: 1, ownerId: ids[0], createdBy: ids[0],
    members, memberCount: members.length, expenses, balances,
    totalExpenseCents: expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
    settlements: minimizeSettlements(balances), settlementHistory: [],
  };
}
