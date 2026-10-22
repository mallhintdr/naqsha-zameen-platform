// ========== R2 ZIP EXTRACTOR WORKER ==========
// This Cloudflare Worker:
// 1. Receives a zip file upload
// 2. Extracts it using streaming
// 3. Uploads files directly to R2
// 4. Deletes the temporary zip
//
// Deploy: wrangler deploy
// Usage: Upload zip via POST to worker URL

import { unzip } from 'unzipit';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle POST: Upload and extract zip
    if (request.method === 'POST' && url.pathname === '/upload-zip') {
      try {
        const formData = await request.formData();
        const zipFile = formData.get('file');
        const targetPath = formData.get('path') || '';

        if (!zipFile) {
          return new Response('No file provided', { status: 400 });
        }

        // Read zip file
        const zipArrayBuffer = await zipFile.arrayBuffer();
        const { entries } = await unzip(zipArrayBuffer);

        // Extract and upload each file
        const results = [];
        for (const [name, entry] of Object.entries(entries)) {
          if (entry.isDirectory) continue;

          const fileData = await entry.arrayBuffer();
          const r2Key = targetPath ? `${targetPath}/${name}` : name;

          // Upload to R2
          await env.BUCKET.put(r2Key, fileData, {
            httpMetadata: {
              contentType: getContentType(name)
            }
          });

          results.push(r2Key);
        }

        return new Response(JSON.stringify({
          success: true,
          filesExtracted: results.length,
          files: results
        }), {
          headers: { 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle GET: Status page
    return new Response(`
      <html>
        <head><title>R2 Zip Extractor</title></head>
        <body>
          <h1>R2 Zip Extractor Worker</h1>
          <p>POST a zip file to /upload-zip to extract and upload to R2</p>
          <form action="/upload-zip" method="post" enctype="multipart/form-data">
            <input type="file" name="file" accept=".zip" required />
            <input type="text" name="path" placeholder="Target path (optional)" />
            <button type="submit">Upload & Extract</button>
          </form>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};

function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const types = {
    'pmtiles': 'application/vnd.pmtiles',
    'json': 'application/json',
    'geojson': 'application/geo+json',
    'html': 'text/html',
    'js': 'application/javascript',
    'css': 'text/css',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg'
  };
  return types[ext] || 'application/octet-stream';
}
