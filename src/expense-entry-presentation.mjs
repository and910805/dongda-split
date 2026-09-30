/** Format only the display value; never round, convert, or mutate the draft amount. */
export function formatEntryAmount(value) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d*)?$/.test(text)) return text;
  const [whole, fraction] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Date-only values must not pass through UTC or a browser timezone conversion. */
export function formatEntryDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return '選擇日期';
  const [year, month, day] = value.split('-');
  const short = `${Number(month)}/${Number(day)}`;
  if (value === today) return `今天 · ${short}`;
  return year === String(today ?? '').slice(0, 4) ? short : `${year}/${month}/${day}`;
}

/** Recovered draft IDs and API IDs may differ in representation, not identity. */
export function isSelectedMember(selected, id) {
  return id !== undefined && id !== null && selected.some(value => String(value) === String(id));
}
