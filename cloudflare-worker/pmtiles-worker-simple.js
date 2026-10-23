/**
 * Simplified Cloudflare Worker for PMTiles Serving
 * 
 * This worker serves PMTiles directly from R2 bucket without authentication.
 * Handles Range requests and provides CDN caching.
 * 
 * Environment Variables Required:
 * - PMTILES_BUCKET (binding): R2 bucket binding
 */

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://dashboard.naqsha-zameen.pk',
  'https://dashboard.naqsha-zameen.com',
  'http://localhost:3000',
  'http://localhost:5000'
];

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    try {
      // Log incoming request for debugging
      console.log(`[Worker] ${request.method} ${request.url}`);
      console.log(`[Worker] Origin: ${request.headers.get('Origin')}`);
      
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        console.log('[Worker] Handling CORS preflight');
        return handleCORS(request);
      }

      // Parse URL and extract file path
      const url = new URL(request.url);
      const pathname = url.pathname;
      
      // Handle health check
      if (pathname === '/health' || pathname === '/') {
        return new Response(JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '2d193602-b26f-43e4-9322-27780964da06',
          bucket: 'geo-dashboard-pmtiles'
        }), {
          status: 200,
          headers: {
            ...getCORSHeaders(request),
            'Content-Type': 'application/json'
          }
        });
      }
      
      // Handle listing endpoints
      if (pathname === '/list-tehsils') {
        return handleListTehsils(request, env);
      }
      
      if (pathname.startsWith('/list-mouzas/')) {
        const tehsil = decodeURIComponent(pathname.substring('/list-mouzas/'.length));
        return handleListMouzas(request, env, tehsil);
      }

      // Get file path (remove leading slash and decode)
      const filePath = decodeURIComponent(pathname.substring(1));
      
      if (!filePath) {
        return new Response('File path required', { 
          status: 400,
          headers: getCORSHeaders(request)
        });
      }

      // Try Cloudflare Cache API first
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      
      let response = await cache.match(cacheKey);
      
      if (response) {
        console.log(`[Cache HIT] ${filePath}`);
        const headers = new Headers(response.headers);
        Object.entries(getCORSHeaders(request)).forEach(([key, value]) => {
          headers.set(key, value);
        });
        headers.set('X-Cache', 'HIT');
        
        return new Response(response.body, {
          status: response.status,
          headers
        });
      }

      console.log(`[Cache MISS] ${filePath}`);

      // Fetch from R2 bucket with timeout handling
      try {
        console.log(`[Worker] Fetching from R2: ${filePath}`);
        const r2Object = await env.PMTILES_BUCKET.get(filePath, {
          range: request.headers,
          onlyIf: request.headers
        });

      if (!r2Object) {
        console.log(`[Worker] File not found in R2: ${filePath}`);
        return new Response('File not found', { 
          status: 404,
          headers: getCORSHeaders(request)
        });
      }

      console.log(`[Worker] R2 object retrieved successfully: ${filePath}`);

      // Handle Range requests (HTTP 206 Partial Content)
      const headers = new Headers(getCORSHeaders(request));
      r2Object.writeHttpMetadata(headers);
      
      // Set content type based on file extension
      if (filePath.endsWith('.pmtiles')) {
        headers.set('Content-Type', 'application/x-protobuf');
      } else if (filePath.endsWith('.json')) {
        headers.set('Content-Type', 'application/json');
      }
      
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Cache-Control', 'public, max-age=86400, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Cache', 'MISS');
      headers.set('Connection', 'keep-alive'); // Keep connection alive
      headers.set('Keep-Alive', 'timeout=30'); // 30 second keepalive

      const status = r2Object.range ? 206 : 200;
      
      response = new Response(r2Object.body, { status, headers });

      // Cache full responses (not ranges)
      if (!r2Object.range && status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
      
      } catch (r2Error) {
        console.error('[Worker] R2 fetch error:', r2Error);
        console.error('[Worker] Error stack:', r2Error.stack);
        return new Response(JSON.stringify({ 
          error: 'R2 storage temporarily unavailable',
          message: r2Error.message,
          timestamp: new Date().toISOString()
        }), { 
          status: 503,
          headers: {
            ...getCORSHeaders(request),
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

    } catch (error) {
      console.error('[Worker] General error:', error);
      console.error('[Worker] Error stack:', error.stack);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      }), { 
        status: 500,
        headers: {
          ...getCORSHeaders(request),
          'Content-Type': 'application/json'
        }
      });
    }
  }
};

/**
 * Get CORS headers for response
 */
function getCORSHeaders(request) {
  const origin = request.headers.get('Origin');
  
  // If origin is in allowed list, use it; otherwise allow all localhost origins
  let allowedOrigin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    allowedOrigin = origin;
  } else if (origin && origin.startsWith('http://localhost:')) {
    allowedOrigin = origin; // Allow any localhost port
  } else {
    allowedOrigin = '*'; // Allow all for non-credentialed requests
  }
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': allowedOrigin !== '*' ? 'true' : undefined
  };
}

/**
 * Handle CORS preflight requests
 */
function handleCORS(request) {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(request)
  });
}

/**
 * List all tehsils in R2 bucket
 */
async function handleListTehsils(request, env) {
  try {
    const listed = await env.PMTILES_BUCKET.list({ delimiter: '/' });
    const tehsils = listed.delimitedPrefixes.map(prefix => prefix.replace('/', ''));
    
    return new Response(JSON.stringify({ tehsils }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(request)
      }
    });
  } catch (error) {
    console.error('Error listing tehsils:', error);
    return new Response(JSON.stringify({ error: 'Failed to list tehsils' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(request)
      }
    });
  }
}

/**
 * List all mouzas in a tehsil
 */
async function handleListMouzas(request, env, tehsil) {
  try {
    const prefix = `${tehsil}/`;
    const listed = await env.PMTILES_BUCKET.list({ prefix });
    
    const mouzas = new Set();
    listed.objects.forEach(obj => {
      const relativePath = obj.key.substring(prefix.length);
      if (relativePath.endsWith('.pmtiles') && !relativePath.includes('-complete.pmtiles')) {
        const mouzaName = relativePath.replace('.pmtiles', '');
        mouzas.add(mouzaName);
      }
    });
    
    return new Response(JSON.stringify({ mouzas: Array.from(mouzas) }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(request)
      }
    });
  } catch (error) {
    console.error('Error listing mouzas:', error);
    return new Response(JSON.stringify({ error: 'Failed to list mouzas' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(request)
      }
    });
  }
}
