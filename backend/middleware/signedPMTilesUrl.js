const crypto = require('crypto');

// Get signing key from environment
const SIGNING_KEY = process.env.PMTILES_SIGNING_KEY ? process.env.PMTILES_SIGNING_KEY.trim() : '';
const CLOUDFLARE_WORKER_URL = process.env.CLOUDFLARE_WORKER_URL || process.env.REACT_APP_CLOUDFLARE_WORKER_URL;

// Helper to generate HMAC-SHA256 signature
const generateSignature = (payload) => {
  if (!SIGNING_KEY) {
    throw new Error('PMTILES_SIGNING_KEY not configured');
  }
  return crypto
    .createHmac('sha256', SIGNING_KEY)
    .update(payload)
    .digest('hex');
};

// Generate a single signed URL for a file
const createSignedUrl = (fileSpec, userId) => {
  const { tehsil, mouza, murabba, filename } = fileSpec;

  // 1 hour expiration
  const exp = Math.floor(Date.now() / 1000) + 3600;

  // Construct partial file path (matches how Cloudflare worker expects it "filePath")
  // Cloudflare worker: decodeURIComponent(pathname.substring(1))
  // If URL is /Tehsil/Mouza/123.pmtiles, filePath is Tehsil/Mouza/123.pmtiles

  let relativePath;
  if (filename) {
    relativePath = `${tehsil}/${filename}`;
  } else if (murabba) {
    // Sanitize murabba: replace / with - (matching backend logic)
    const safeMurabba = String(murabba).replace(/\//g, "-");
    relativePath = `${tehsil}/${mouza}/${safeMurabba}.pmtiles`;
  } else {
    relativePath = `${tehsil}/${mouza}.pmtiles`;
  }

  // Payload: filePath|exp|userId
  const payload = `${relativePath}|${exp}|${userId}`;
  const token = generateSignature(payload);

  // Base URL (Cloudflare Worker)
  // Ensure no trailing slash
  const baseUrl = CLOUDFLARE_WORKER_URL ? CLOUDFLARE_WORKER_URL.replace(/\/$/, '') : '';

  // Construct final URL
  // Encode the path to ensure spaces and special chars are handled safely in the URL
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');

  const url = `${baseUrl}/${encodedPath}?token=${token}&exp=${exp}&uid=${userId}`;

  return {
    url,
    path: relativePath, // Return the raw cache key path
    expiresAt: exp * 1000
  };
};

// Linked tehsils: R2 keeps each mouza under its original tehsil folder, so a
// group (or other linked) name is swapped for the tehsil that holds the mouza.
const realTehsil = async (tehsil, mouza, filename) => {
  try {
    const { resolveTehsilForMouza } = require('../utils/linkedTehsilPath');
    const m = mouza || String(filename || '').replace(/(-Murabba\.json|-complete\.pmtiles|\.pmtiles)$/i, '');
    return (await resolveTehsilForMouza(tehsil, m)) || tehsil;
  } catch { return tehsil; }
};

module.exports = {
  // POST /api/pmtiles/signed-url
  generateSignedUrlMiddleware: async (req, res) => {
    try {
      const { mouza, murabba, filename } = req.body;
      const tehsil = req.body.tehsil ? await realTehsil(req.body.tehsil, mouza, filename) : req.body.tehsil;
      const userId = req.user.userId;

      if (!SIGNING_KEY) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Signing key missing'
        });
      }

      if (!tehsil || (!mouza && !filename)) {
        return res.status(400).json({
          success: false,
          message: 'Missing required parameters'
        });
      }

      const result = createSignedUrl({ tehsil, mouza, murabba, filename }, userId);

      res.json({
        success: true,
        url: result.url,
        expiresAt: result.expiresAt
      });

    } catch (error) {
      console.error('Error generating signed URL:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate signed URL'
      });
    }
  },

  // POST /api/pmtiles/signed-urls (Batch)
  generateBatchSignedUrlsMiddleware: async (req, res) => {
    try {
      const { files } = req.body; // Expects array of { tehsil, mouza, murabba?, filename? }
      const userId = req.user.userId;

      if (!SIGNING_KEY) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Signing key missing'
        });
      }

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid files array'
        });
      }

      if (files.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Batch size limit exceeded (max 50)'
        });
      }

      const urls = await Promise.all(files.map(async file => {
        try {
          // If params missing, skip
          if (!file.tehsil || (!file.mouza && !file.filename)) {
            return { error: 'Invalid parameters', fileSpec: file };
          }
          const tehsil = await realTehsil(file.tehsil, file.mouza, file.filename);
          return createSignedUrl({ ...file, tehsil }, userId);
        } catch (e) {
          return { error: 'Generation failed', fileSpec: file };
        }
      }));

      res.json({
        success: true,
        urls
      });

    } catch (error) {
      console.error('Error generating batch signed URLs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate batch signed URLs'
      });
    }
  }
};
