// /ads.txt — authorises Google to sell ads on this domain. Generated from ADS in src/site.ts.
import type { APIRoute } from 'astro';
import { ADS, adsEnabled } from '../site';

export const GET: APIRoute = () => {
  const body = adsEnabled()
    ? `google.com, ${ADS.adsenseClient.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`
    : '# No advertising partners yet.\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
