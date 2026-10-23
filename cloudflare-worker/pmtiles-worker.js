/**
 * Cloudflare Worker for Secure PMTiles Serving
 * 
 * This worker acts as a secure gateway between your React app and R2 bucket.
 * It validates HMAC-signed URLs, handles Range requests, and provides CDN caching.
 * 
 * Environment Variables Required:
 * - PMTILES_SIGNING_KEY (secret): HMAC key for URL validation
 * - PMTILES_BUCKET (binding): R2 bucket binding
 */

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://dashboard.naqsha-zameen.pk',
  'https://dashboard.naqsha-zameen.com',
  'http://localhost:3000'
];

// Rate limiting configuration (requests per minute per user)
const RATE_LIMIT = 5000; // Increased for production use
const rateLimitMap = new Map();

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return handleCORS(request);
      }

      // Parse URL and extract file path
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Handle listing endpoints (public, no auth required for dropdowns)
      if (pathname === '/list-tehsils') {
        return handleListTehsils(request, env);
      }

      if (pathname.startsWith('/list-mouzas/')) {
        const tehsil = decodeURIComponent(pathname.substring('/list-mouzas/'.length));
        return handleListMouzas(request, env, tehsil);
      }

      const filePath = decodeURIComponent(pathname.substring(1)); // Remove leading slash and decode

      // Allow public access to Metadata JSON files (they're just killa numbers, not sensitive)
      if (filePath.endsWith('-Metadata.json')) {
        const r2Object = await env.PMTILES_BUCKET.get(filePath);

        if (!r2Object) {
          return new Response('Metadata file not found', {
            status: 404,
            headers: getCORSHeaders(request)
          });
        }

        const headers = new Headers(getCORSHeaders(request));
        headers.set('Content-Type', 'application/json');
        headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

        return new Response(r2Object.body, {
          status: 200,
          headers
        });
      }

      // Validate request
      const validationResult = await validateRequest(request, env, filePath);
      if (!validationResult.valid) {
        return new Response(validationResult.error, {
          status: validationResult.status,
          headers: getCORSHeaders(request)
        });
      }

      // Check rate limiting
      const userId = validationResult.userId;
      if (!checkRateLimit(userId)) {
        return new Response('Rate limit exceeded. Please try again later.', {
          status: 429,
          headers: getCORSHeaders(request)
        });
      }

      // Try Cloudflare Cache API first for faster repeated requests
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), {
        method: 'GET',
        headers: request.headers
      });

      let response = await cache.match(cacheKey);

      if (response) {
        console.log(`[Cache HIT] ${filePath}`);
        // Add CORS headers to cached response
        const headers = new Headers(response.headers);
        const corsHeaders = getCORSHeaders(request);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });
        headers.set('X-Cache', 'HIT');
        headers.set('X-User-ID', userId);

        return new Response(response.body, {
          status: response.status,
          headers
        });
      }

      console.log(`[Cache MISS] ${filePath}`);

      // Fetch from R2 bucket
      const r2Object = await env.PMTILES_BUCKET.get(filePath, {
        range: request.headers,
        onlyIf: request.headers
      });

      if (!r2Object) {
        return new Response('PMTile file not found', {
          status: 404,
          headers: getCORSHeaders(request)
        });
      }

      // Handle Range requests (HTTP 206 Partial Content)
      const headers = new Headers(getCORSHeaders(request));
      r2Object.writeHttpMetadata(headers);
      headers.set('Content-Type', 'application/vnd.pmtiles');
      headers.set('Accept-Ranges', 'bytes');

      // CDN caching - cache for 24 hours (PMTiles are immutable)
      headers.set('Cache-Control', 'public, max-age=86400, immutable, no-transform');

      // Security headers
      headers.set('X-Content-Type-Options', 'nosniff');

      // Add user tracking and cache status headers
      headers.set('X-User-ID', userId);
      headers.set('X-Cache', 'MISS');

      const status = r2Object.range ? 206 : 200;

      response = new Response(r2Object.body, {
        status,
        headers
      });

      // Store in Cloudflare Cache API for future requests (only cache full responses, not ranges)
      if (!r2Object.range && status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;

    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal server error', {
        status: 500,
        headers: getCORSHeaders(request)
      });
    }
  }
};

/**
 * Validate HMAC-signed URL token
 */
async function validateRequest(request, env, filePath) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const exp = url.searchParams.get('exp');
  const userId = url.searchParams.get('uid');

  // Check if all required parameters are present
  if (!token || !exp || !userId) {
    return {
      valid: false,
      status: 401,
      error: 'Missing authentication parameters'
    };
  }

  // Check expiration
  const expirationTime = parseInt(exp);
  const currentTime = Math.floor(Date.now() / 1000);

  if (currentTime > expirationTime) {
    return {
      valid: false,
      status: 403,
      error: 'URL has expired. Please refresh and try again.'
    };
  }

  // Validate HMAC signature
  const signingKey = env.PMTILES_SIGNING_KEY;
  if (!signingKey) {
    console.error('PMTILES_SIGNING_KEY not configured');
    return {
      valid: false,
      status: 500,
      error: 'Server configuration error'
    };
  }

  const payload = `${filePath}|${exp}|${userId}`;
  const expectedToken = await generateHMAC(payload, signingKey);

  if (token !== expectedToken) {
    return {
      valid: false,
      status: 403,
      error: 'Invalid authentication token'
    };
  }

  return {
    valid: true,
    userId
  };
}

/**
 * Generate HMAC-SHA256 signature
 */
async function generateHMAC(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Rate limiting check
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const userKey = `user:${userId}`;

  if (!rateLimitMap.has(userKey)) {
    rateLimitMap.set(userKey, { count: 1, resetTime: now + 60000 });
    return true;
  }

  const userLimit = rateLimitMap.get(userKey);

  // Reset if minute has passed
  if (now > userLimit.resetTime) {
    rateLimitMap.set(userKey, { count: 1, resetTime: now + 60000 });
    return true;
  }

  // Check if under limit
  if (userLimit.count < RATE_LIMIT) {
    userLimit.count++;
    return true;
  }

  return false;
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
 * Get CORS headers based on origin
 */
function getCORSHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
    // The PMTiles reader needs these on cross-origin range responses
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
    'Access-Control-Max-Age': '86400'
  };

  // Always allow localhost for development, or if origin matches allowed list
  if (origin && (origin.includes('localhost') || ALLOWED_ORIGINS.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    // Fallback for development
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

/**
 * List all tehsils from R2 bucket structure
 * Scans bucket for top-level directories (tehsils) with pagination support
 */
async function handleListTehsils(request, env) {
  try {
    const tehsilSet = new Set();
    let cursor = undefined;
    let hasMore = true;

    // Paginate through all top-level folders
    while (hasMore) {
      const listed = await env.PMTILES_BUCKET.list({
        delimiter: '/',
        limit: 1000,
        cursor: cursor
      });

      // Extract tehsil names from prefixes
      for (const prefix of (listed.delimitedPrefixes || [])) {
        // prefix format: "Tehsil Name/"
        const tehsil = prefix.replace(/\/$/, ''); // Remove trailing slash
        if (tehsil) {
          tehsilSet.add(tehsil);
        }
      }

      // Check if there are more pages
      hasMore = listed.truncated;
      cursor = listed.cursor;
    }

    const tehsils = Array.from(tehsilSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const headers = new Headers(getCORSHeaders(request));
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    return new Response(JSON.stringify(tehsils), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Error listing tehsils:', error);
    const headers = new Headers(getCORSHeaders(request));
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify([]), {
      status: 500,
      headers
    });
  }
}

/**
 * List all mouzas for a given tehsil from R2 bucket
 * First tries to use <Tehsil>-Mouza-Index.json for fast lookup
 * Falls back to scanning all .pmtiles files if index doesn't exist
 */
async function handleListMouzas(request, env, tehsil) {
  const headers = new Headers(getCORSHeaders(request));
  headers.set('Content-Type', 'application/json');

  try {
    if (!tehsil) {
      return new Response(JSON.stringify([]), {
        status: 400,
        headers
      });
    }

    // Try to fetch the index file first (fast path)
    const indexKey = `${tehsil}/${tehsil}-Mouza-Index.json`;
    try {
      const indexObject = await env.PMTILES_BUCKET.get(indexKey);
      if (indexObject) {
        const indexText = await indexObject.text();
        const mouzas = JSON.parse(indexText);

        if (Array.isArray(mouzas) && mouzas.length > 0) {
          headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
          headers.set('X-Source', 'index'); // Indicate this came from index

          return new Response(JSON.stringify(mouzas.sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          )), {
            status: 200,
            headers
          });
        }
      }
    } catch (indexError) {
      // Index doesn't exist or is invalid, fall back to scanning
      console.log(`Index not found for ${tehsil}, falling back to scan:`, indexError.message);
    }

    // Fallback: Scan all .pmtiles files (slow path)
    const mouzaSet = new Set();
    const prefix = `${tehsil}/`;
    let cursor = undefined;
    let hasMore = true;

    // Paginate through all objects in tehsil folder
    while (hasMore) {
      const listed = await env.PMTILES_BUCKET.list({
        prefix: prefix,
        limit: 1000,
        cursor: cursor
      });

      // Extract mouza names from ALL .pmtiles files in tehsil folder
      // Structure: Tehsil/Mouza/*.pmtiles
      // We want to extract unique Mouza names
      for (const object of (listed.objects || [])) {
        const key = object.key; // e.g., "Tehsil/Mouza/123.pmtiles" or "Tehsil/Mouza.pmtiles"

        // Remove prefix to get relative path
        const relativePath = key.substring(prefix.length); // e.g., "Mouza/123.pmtiles" or "Mouza.pmtiles"

        // Only process .pmtiles files
        if (relativePath.endsWith('.pmtiles')) {
          // Extract mouza name from path
          // If path contains "/", mouza is the first segment (e.g., "Mouza/123.pmtiles" -> "Mouza")
          // If no "/", mouza is the filename without extension (e.g., "Mouza.pmtiles" -> "Mouza")
          let mouza;
          if (relativePath.includes('/')) {
            // Get first segment (mouza folder name)
            mouza = relativePath.split('/')[0];
          } else {
            // File directly in tehsil root, use filename without extension
            mouza = relativePath.replace('.pmtiles', '');
          }

          if (mouza) {
            mouzaSet.add(mouza);
          }
        }
      }

      // Check if there are more pages
      hasMore = listed.truncated;
      cursor = listed.cursor;
    }

    const mouzas = Array.from(mouzaSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const headers = new Headers(getCORSHeaders(request));
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    headers.set('X-Source', 'scan'); // Indicate this came from full scan

    return new Response(JSON.stringify(mouzas), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error(`Error listing mouzas for ${tehsil}:`, error);
    const headers = new Headers(getCORSHeaders(request));
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify([]), {
      status: 500,
      headers
    });
  }
}
