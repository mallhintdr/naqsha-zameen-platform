/** Shows a WhatsApp-style text: *word* is bold, _word_ is italic, the stars themselves are hidden. */
import { Fragment, type ReactNode } from 'react';

// No lookbehind: older iPhones (Safari < 16.4) cannot parse it.
const TOKEN = /\*([^*\n]+)\*|(^|[^\w])_([^_\n]+)_(?![\w])/g;

export default function WaText({ text }: { text?: string | null }) {
  const s = String(text || '');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const lead = m[2] || '';
    const at = (m.index ?? 0) + lead.length;
    if (at > last) out.push(s.slice(last, at));
    out.push(m[1] != null ? <strong key={at}>{m[1]}</strong> : <em key={at}>{m[3]}</em>);
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <Fragment>{out}</Fragment>;
}
