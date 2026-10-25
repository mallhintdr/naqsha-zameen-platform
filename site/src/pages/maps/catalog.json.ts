import type { APIRoute } from 'astro';
import { getCatalog } from '../../mouza-catalog';

// Names only, for the tehsil / mouza picker: [[tehsil, tehsilSlug, [[mouza, mouzaSlug], ...]], ...]
export const GET: APIRoute = async () => {
  const tehsils = await getCatalog();
  const data = tehsils.map((t) => [t.name, t.slug, t.mouzas.map((m) => [m.name, m.slug])]);
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
