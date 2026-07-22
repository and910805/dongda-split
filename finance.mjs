import crypto from 'node:crypto';

const signOf = value => value < 0 ? -1 : 1;

export function allocateEqual(totalCents, memberIds, randomize = true) {
  const ids = [...new Set(memberIds)];
  if (!Number.isSafeInteger(totalCents) || totalCents === 0 || !ids.length) throw new Error('invalid equal split');
  if (randomize) {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  const sign = signOf(totalCents), absolute = Math.abs(totalCents);
  const base = Math.floor(absolute / ids.length), remainder = absolute % ids.length;
  return ids.map((userId, index) => ({ userId, shareCents: sign * (base + (index < remainder ? 1 : 0)) }));
}

export function allocateByWeights(totalCents, weights) {
  const clean = weights.map(x => ({ userId: String(x.userId), weight: Number(x.weight) }));
  if (!Number.isSafeInteger(totalCents) || totalCents === 0 || !clean.length || clean.some(x => !Number.isFinite(x.weight) || x.weight <= 0) || new Set(clean.map(x => x.userId)).size !== clean.length) throw new Error('invalid weights');
  const totalWeight = clean.reduce((sum, x) => sum + x.weight, 0), absolute = Math.abs(totalCents), sign = signOf(totalCents);
  const result = clean.map(x => { const raw = absolute * x.weight / totalWeight, floor = Math.floor(raw); return { userId: x.userId, shareCents: floor, fraction: raw - floor } });
  let remainder = absolute - result.reduce((sum, x) => sum + x.shareCents, 0);
  result.sort((a, b) => b.fraction - a.fraction || a.userId.localeCompare(b.userId));
  for (let i = 0; i < remainder; i++) result[i % result.length].shareCents++;
  return result.map(({ userId, shareCents }) => ({ userId, shareCents: sign * shareCents }));
}

export function allocateHybrid(totalCents, participantIds, fixedShares) {
  const ids = [...new Set(participantIds.map(String))], fixed = fixedShares.map(x => ({ userId: String(x.userId), shareCents: Number(x.shareCents) }));
  if (!ids.length || fixed.some(x => !ids.includes(x.userId) || !Number.isSafeInteger(x.shareCents) || x.shareCents === 0) || new Set(fixed.map(x => x.userId)).size !== fixed.length) throw new Error('invalid hybrid split');
  const fixedTotal = fixed.reduce((sum, x) => sum + x.shareCents, 0), remaining = totalCents - fixedTotal, fixedIds = new Set(fixed.map(x => x.userId)), flexible = ids.filter(id => !fixedIds.has(id));
  if (!flexible.length ? remaining !== 0 : remaining === 0 || signOf(remaining) !== signOf(totalCents)) throw new Error('invalid hybrid remainder');
  return [...fixed, ...(flexible.length ? allocateEqual(remaining, flexible) : [])];
}

export function minimizeSettlements(allBalances) {
  const active = allBalances.filter(x => x.balanceCents !== 0);
  if (!active.length) return [];
  let groups = [active];
  if (active.length <= 18) {
    const size = 1 << active.length, sums = new Array(size).fill(0);
    for (let mask = 1; mask < size; mask++) { const bit = mask & -mask, index = Math.log2(bit); sums[mask] = sums[mask ^ bit] + active[index].balanceCents }
    const memo = new Map([[0, 0]]), choice = new Map();
    const solve = mask => { if (memo.has(mask)) return memo.get(mask); const first = mask & -mask; let best = -Infinity, bestSubset = 0; for (let subset = mask; subset; subset = (subset - 1) & mask) { if ((subset & first) && sums[subset] === 0) { const rest = solve(mask ^ subset); if (rest !== -Infinity && rest + 1 > best) { best = rest + 1; bestSubset = subset } } } memo.set(mask, best); if (bestSubset) choice.set(mask, bestSubset); return best };
    let mask = size - 1; solve(mask); groups = []; while (mask) { const subset = choice.get(mask) || mask, members = []; for (let i = 0; i < active.length; i++) if (subset & (1 << i)) members.push(active[i]); groups.push(members); mask ^= subset }
  }
  const transfers = [];
  for (const members of groups) {
    const debtors = members.filter(x => x.balanceCents < 0).map(x => ({ ...x, left: -x.balanceCents }));
    const creditors = members.filter(x => x.balanceCents > 0).map(x => ({ ...x, left: x.balanceCents }));
    while (debtors.length && creditors.length) { debtors.sort((a, b) => b.left - a.left); creditors.sort((a, b) => b.left - a.left); const debtor = debtors[0], creditor = creditors[0], amount = Math.min(debtor.left, creditor.left); transfers.push({ from: debtor, to: creditor, amountCents: amount }); debtor.left -= amount; creditor.left -= amount; if (debtor.left === 0) debtors.shift(); if (creditor.left === 0) creditors.shift() }
  }
  return transfers;
}
