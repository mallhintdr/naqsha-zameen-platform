const dotenv = require('dotenv');
const fs = require('fs');
try {
  const pathMod = require('path');
  const envPath = pathMod.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
} catch { }

// Validate required environment variables
const requiredEnvVars = ['MONGO_URI', 'SECRET_KEY'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Validate SECRET_KEY strength
if (process.env.SECRET_KEY && process.env.SECRET_KEY.length < 32) {
  console.error('FATAL: SECRET_KEY must be at least 32 characters');
  process.exit(1);
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const compression = require('compression');
const uuidv4 = () => require('crypto').randomUUID();
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { isAllowedOrigin } = require('./utils/allowedOrigins');

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const geoRoutes = require('./routes/geoRoutes');
const dataRoutes = require('./routes/dataRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const locationRoutes = require('./routes/locationRoutes');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const _IS_PROD_SERVER = process.env.NODE_ENV === 'production' || process.platform === 'linux';
const CORS_ORIGIN = process.env.CORS_ORIGIN || (_IS_PROD_SERVER ? 'https://dashboard.naqsha-zameen.pk' : 'http://localhost:3000');

// ─── 1. Core Security & CORS (Must be first) ──────────────────────────────────────
const corsOptions = {
  // www / apex / dashboard / api and any https subdomain of naqsha-zameen.pk, localhost, CORS_ORIGIN list.
  // Unknown origins get no CORS headers (browser blocks) instead of a 500 error.
  origin: function (origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },

  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['X-Request-ID']
};

app.use(cors(corsOptions));

// Pre-flight requests
app.options('*', cors(corsOptions));

try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", CORS_ORIGIN, "http://localhost:5000", "ws://localhost:5000", "wss:",
          process.env.CLOUDFLARE_WORKER_URL || process.env.REACT_APP_CLOUDFLARE_WORKER_URL || "https://pmtiles-worker.mallhintdr.workers.dev",
          "https://api.ngdc.noaa.gov", "https://challenges.cloudflare.com"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://challenges.cloudflare.com"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
        // NOTE: scriptSrc/styleSrc still allow 'unsafe-inline'. Removing it is a
        // follow-up that requires building the CRA app with INLINE_RUNTIME_CHUNK=false
        // (or nonces) and verifying Leaflet/react-bootstrap inline styles still render.
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));
} catch (e) {
  logger.warn('Helmet not installed, using basic security headers');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
}

// Request ID tracking middleware (must be first)
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      requestId: req.id,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  next();
});

// Compression middleware
// PERF-02: Skip compression for routes that already serve pre-compressed/binary
// content (PMTiles, tile PNGs, shapefile archives). Gzip-ing these wastes CPU
// on every request for zero size benefit and can even fight Range requests.
const COMPRESSION_EXEMPT_PREFIXES = ['/pmtiles', '/tiles', '/Shajra Parcha', '/JSON%20Murabba', '/JSON Murabba'];
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    if (COMPRESSION_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) {
      return false;
    }
    const contentType = res.getHeader('Content-Type') || '';
    if (/^(image\/|application\/vnd\.pmtiles)/.test(String(contentType))) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// Body parsing with different limits for different routes
app.use('/api/geojson', express.json({ limit: '5mb' }));
app.use('/api/auth', express.json({ limit: '100kb' }));
app.use('/api/payment-proofs', express.json({ limit: '4mb' })); // compressed payment screenshots
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── CSRF Protection (SEC-02) ────────────────────────────────────────────────────
// Custom stateless double-submit CSRF — uses Node's built-in crypto, no library.
// Token = nonce + '.' + HMAC-SHA256(SECRET_KEY + ':' + sessionId + ':' + nonce)
// Validated purely from the x-csrf-token header — no cross-domain cookie dependency.
// This removes all csrf-csrf library API version issues.
//
// Cookie domain: auto-derived from CORS_ORIGIN so no .env change needed on VPS.
// e.g. CORS_ORIGIN=https://dashboard.naqsha-zameen.pk  →  .naqsha-zameen.pk
const crypto = require('crypto');
const _DERIVED_COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || (() => {
    if (!_IS_PROD_SERVER) return undefined;
    try {
        const origin = CORS_ORIGIN || 'https://dashboard.naqsha-zameen.pk';
        const hostname = new URL(origin).hostname;
        const parts = hostname.split('.');
        return parts.length >= 2 ? '.' + parts.slice(-2).join('.') : undefined;
    } catch (_) { return undefined; }
})();
const _CSRF_SAMESITE = (process.env.COOKIE_SAMESITE || (_IS_PROD_SERVER ? 'none' : 'lax')).toLowerCase();
// Chrome 80+: SameSite=None cookies MUST have Secure=true or they are silently discarded
const _CSRF_SECURE   = _IS_PROD_SERVER || _CSRF_SAMESITE === 'none';
const _CSRF_SECRET   = process.env.SECRET_KEY;

function generateCsrfToken(req, res) {
    const sessionId = req.cookies?.authToken || 'anonymous';
    const nonce = crypto.randomBytes(32).toString('hex');
    const hmac  = crypto.createHmac('sha256', _CSRF_SECRET)
        .update(`${nonce}:${sessionId}`)
        .digest('hex');
    const token = `${nonce}.${hmac}`;
    // Companion cookie (defense-in-depth; validation is header-only so cross-domain works)
    res.cookie('x-csrf-token', nonce, {
        httpOnly: true,
        secure:   _CSRF_SECURE,
        sameSite: _CSRF_SAMESITE,
        domain:   _DERIVED_COOKIE_DOMAIN,
        path:     '/'
    });
    return token;
}

function doubleCsrfProtection(req, res, next) {
    // GET/HEAD/OPTIONS are safe methods — skip validation
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const headerToken = req.headers['x-csrf-token'];
    if (!headerToken) {
        logger.warn('CSRF: missing header token', { url: req.url, method: req.method, ip: req.ip });
        return res.status(403).json({ error: 'CSRF token missing' });
    }

    const dotIdx = headerToken.lastIndexOf('.');
    if (dotIdx === -1) {
        return res.status(403).json({ error: 'CSRF token malformed' });
    }

    const nonce = headerToken.substring(0, dotIdx);
    const hmac  = headerToken.substring(dotIdx + 1);
    const sessionId = req.cookies?.authToken || 'anonymous';
    const expectedHmac = crypto.createHmac('sha256', _CSRF_SECRET)
        .update(`${nonce}:${sessionId}`)
        .digest('hex');

    let valid = false;
    try {
        valid = hmac.length === expectedHmac.length &&
                crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
    } catch (_) { valid = false; }

    if (!valid) {
        logger.warn('CSRF validation failed', {
            url: req.url, method: req.method, ip: req.ip,
            headerToken: 'present',
            authToken: req.cookies?.authToken ? 'present' : 'anonymous'
        });
        return res.status(403).json({ error: 'CSRF token validation failed' });
    }
    next();
}

// Paths exempted from CSRF: public registration, login, logout, impersonation, password reset, demo-access redirect, health, push subscribe (token-based), heartbeats
const CSRF_EXEMPT_PREFIXES = [
    '/register', '/api/register',
    '/login', '/api/login',
    '/logout', '/api/logout',
    '/admin/login-as', '/api/admin/login-as',
    '/forgot-password', '/api/forgot-password',
    '/reset-password', '/api/reset-password',
    '/demo-access/', '/health', '/heartbeat', '/api/heartbeat'
];

app.use((req, res, next) => {
    if (CSRF_EXEMPT_PREFIXES.some(p => req.path === p || req.path.startsWith(p))) return next();
    doubleCsrfProtection(req, res, next);
});

// Expose CSRF token to the SPA (rate-limited)
const { apiLimiter } = require('./middleware/rateLimiters');
app.get('/api/csrf-token', apiLimiter, (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) });
});

// Static files — React build (1-day cache for hashed assets)
const ROOT = path.join(__dirname, '..');
const BUILD_ROOT = path.join(ROOT, 'build');
if (require('fs').existsSync(BUILD_ROOT)) {
  app.use(express.static(BUILD_ROOT, {
    maxAge: '1d',
    etag: true,
    lastModified: true,
  }));
}

// SPA pages whose path collides with a legacy API route (the admin stats API is GET /stats,
// and the Insights page is also /stats). A browser navigation asks for HTML; the app's own
// fetches ask for JSON. Serve the SPA for the former so a refresh or link opens the page.
const SPA_PAGE_PATHS = new Set(['/stats']);
app.get([...SPA_PAGE_PATHS], (req, res, next) => {
  const wantsHtml = req.accepts(['json', 'html']) === 'html';
  if (!wantsHtml || !require('fs').existsSync(BUILD_ROOT)) return next();
  return res.sendFile(path.join(BUILD_ROOT, 'index.html'));
});

// Mount Application API & Auth Routes immediately
app.use(authRoutes);
// Before userRoutes: its catch-all /api/users/:userId(*) would swallow /api/users/me/*
app.use(require('./routes/subAdminRoutes'));
app.use(require('./routes/paymentProofRoutes'));
app.use(require('./routes/assignmentRequestRoutes'));
app.use(userRoutes);
app.use(geoRoutes);
app.use(dataRoutes);
app.use(subscriptionRoutes);
app.use(notificationRoutes);
app.use(locationRoutes);
app.use(require('./routes/statsRoutes'));
app.use(require('./routes/tehsilGroupRoutes'));
app.use(require('./routes/landAllotmentRoutes'));
app.use(require('./routes/reportRoutes'));
app.use('/api/config', require('./routes/configRoutes'));

// Helper function for case-insensitive static file lookup and serving (Async & Non-blocking)
const fsPromises = require('fs').promises;
const User = require('./models/User');

const serveCaseInsensitiveStatic = (basePath) => {
  return async (req, res, next) => {
    try {
      const decodedUrlPath = decodeURIComponent(req.path);
      const fullPath = path.join(basePath, decodedUrlPath);
      
      // Try exact match first
      try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.isFile()) {
          return res.sendFile(fullPath);
        }
      } catch (e) {
        // Proceed to case-insensitive search
      }

      // Perform case-insensitive directory search
      const pathParts = decodedUrlPath.split(/[\\/]/).filter(Boolean);
      let currentPath = basePath;
      let matchFailed = false;

      for (const part of pathParts) {
        try {
          await fsPromises.access(currentPath);
          const children = await fsPromises.readdir(currentPath);
          const match = children.find(child => child.toLowerCase() === part.toLowerCase());
          
          if (match) {
            currentPath = path.join(currentPath, match);
          } else {
            matchFailed = true;
            break;
          }
        } catch (e) {
          matchFailed = true;
          break;
        }
      }

      if (!matchFailed) {
        try {
          const stats = await fsPromises.stat(currentPath);
          if (stats.isFile()) {
            return res.sendFile(currentPath);
          }
        } catch (e) {
          // Not a file
        }
      }
      
      next();
    } catch (err) {
      next(err);
    }
  };
};

  const jwtLib = require('jsonwebtoken');

  // Authenticate cookie token for static/range assets with token version validation
  const verifyAuthCookie = async (req, res, next) => {
    const token = req.cookies?.authToken;
    if (!token) {
      logger.warn('Access Denied: No token cookie', { ip: req.ip, path: req.path });
      return res.status(401).json({ message: 'Authentication required' });
    }
    try {
      const decoded = jwtLib.verify(token, process.env.SECRET_KEY);
      
      // Perform token version verification against DB
      const user = await User.findOne({ userId: decoded.userId }).select('tokenVersion').lean();
      if (!user || decoded.tokenVersion !== (user.tokenVersion || 0)) {
        logger.warn('Access Denied: Invalidated token version', { ip: req.ip, path: req.path, userId: decoded.userId });
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
      }

      req.userId = decoded.userId;
      next();
    } catch (err) {
      logger.warn('Access Denied: Invalid token cookie', { ip: req.ip, path: req.path });
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
  };

  // Enforce Tehsil Access Restrictions for Static File serving
  const { getLinkedTehsils } = require('./services/tehsilAliasService');
  const checkTehsilAccessForStatic = async (req, res, next) => {
    try {
      const user = await User.findOne({ userId: req.userId }).select('userType tehsilAccess').lean();
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      if (user.userType === 'admin') return next();

      const decodedPath = decodeURIComponent(req.path);
      const parts = decodedPath.split(/[\\/]/).filter(Boolean);
      if (parts.length === 0) return next();

      let tehsilName = '';
      if (parts[0].toLowerCase().endsWith('-mouza-index.json')) {
        tehsilName = parts[0].substring(0, parts[0].length - 17);
      } else {
        tehsilName = parts[0];
      }

      const linked = await getLinkedTehsils(tehsilName);
      const linkedLower = (linked || [tehsilName]).map(t => t.toLowerCase());

      const hasAccess = user.tehsilAccess?.some(t => linkedLower.includes(t.tehsil.toLowerCase()));
      if (!hasAccess) {
        logger.warn('Forbidden access to static file', { userId: user.userId, path: req.path, tehsil: tehsilName, linked });
        return res.status(403).json({ message: 'Access denied to this tehsil data.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  const PRIVATE_DATA_ROOT = path.join(__dirname, 'data');

  // Linked tehsils: a request under the group (or any linked) name is served from
  // whichever linked tehsil folder actually holds the file.
  const { linkedTehsilRewrite } = require('./utils/linkedTehsilPath');
  const dataRoute = (sub) => [verifyAuthCookie, checkTehsilAccessForStatic, linkedTehsilRewrite(path.join(PRIVATE_DATA_ROOT, sub)), serveCaseInsensitiveStatic(path.join(PRIVATE_DATA_ROOT, sub))];
  app.use('/JSON%20Murabba', ...dataRoute('JSON Murabba'));
  app.use('/JSON Murabba', ...dataRoute('JSON Murabba'));
  app.use('/Metadata', ...dataRoute('Metadata'));
  app.use('/Shajra Parcha', ...dataRoute('Shajra Parcha'));
  app.use('/tiles', ...dataRoute('tiles'));

  // ── PMTiles: Authenticated + range-only (blocks full-file downloads) ──
  const pmtilesDir = path.join(PRIVATE_DATA_ROOT, 'pmtiles');

  app.use('/pmtiles', verifyAuthCookie, checkTehsilAccessForStatic, (req, res, next) => {
    // 1. Block full-file downloads — only Range requests are allowed
    // PMTiles library always requests specific byte chunks (e.g. "bytes=0-16383").
    // Browsers doing a "Save As" / download will often send an open-ended range "bytes=0-".
    const range = req.headers['range'];

    // STRICT CHECK: We block ANY range request that does not specify an explicit end byte.
    // This perfectly allows MapLibre/PMTiles but completely breaks browser downloads.
    if (!range || !range.match(/^bytes=\d+-\d+$/)) {
      logger.warn('PMTiles Access Denied: Open-ended Range or missing Range (Download attempt)', { ip: req.ip, path: req.path, range });
      return res.status(403).json({ message: 'Full file download not permitted' });
    }

    // 2. Performance + security headers
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');

    next();
  }, linkedTehsilRewrite(pmtilesDir), express.static(pmtilesDir, {
    maxAge: '1h',
    etag: true,
    lastModified: true,
    acceptRanges: true,
  }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
      mongodb: 'connected',
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// SPA Catch-all
app.get('*', (req, res, next) => {
  try {
    if (!require('fs').existsSync(BUILD_ROOT)) return next();
    const ignorePrefixes = ['/api', '/health'];
    if (ignorePrefixes.some((p) => req.path.startsWith(p))) return next();
    return res.sendFile(path.join(BUILD_ROOT, 'index.html'));
  } catch (e) {
    return next();
  }
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// DB Connection with retry logic and pooling
const connectDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGO_URI, {
        maxPoolSize: 25, // Issue #13: Increased from 10 for better concurrency
        minPoolSize: 5,  // Issue #13: Increased from 2
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 5000,
        family: 4
      });
      logger.info('Connected to MongoDB');

      // Set global query timeout
      mongoose.set('maxTimeMS', 10000);
      return;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${i + 1} failed`, { error: error.message });
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Connect to database and then start server
const startServer = async () => {
  try {
    await connectDB();

    // Probe Redis availability before any service that depends on it
    const { initRedis } = require('./services/redisClient');
    await initRedis();

    // Start server
    const serverInstance = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        corsOrigin: CORS_ORIGIN,
        cookieDomain: _DERIVED_COOKIE_DOMAIN || '(none)',
        csrfSameSite: _CSRF_SAMESITE
      });

      // Initialize Socket.io
      const socketService = require('./services/socketService');
      socketService.init(serverInstance, CORS_ORIGIN);

      // Initialize Web Push
      const pushService = require('./services/pushNotificationService');
      pushService.init();

      // Initialize Job Queue
      const queueService = require('./services/queueService');
      const queues = queueService.getQueues();

      // Run initial DB hygiene
      const { runCleanupTasks } = require('./utils/dbHygiene');
      runCleanupTasks();

      // Public sign-ups not verified within 24 hours are deleted (record, email,
      // device). Checked at start-up and every hour; safe to run on every instance.
      const { purgeUnverifiedPublicUsers } = require('./services/unverifiedPurge');
      const purge = () => purgeUnverifiedPublicUsers().catch(err => logger.error('Unverified sign-up purge failed', { error: err.message }));
      purge();
      setInterval(purge, 60 * 60 * 1000);

      // Sub-admins are notified when one of their customers' subscriptions expires.
      require('./services/subAdminExpiryNotice').startSubAdminExpiryNotices();

      // Customers using more than one device in 30 days get a daily sharing warning.
      require('./services/multiUseWarning').startDailyWarning();

      // If BullMQ is not active (e.g. REDIS_ENABLED=false), run daily hygiene via in-memory timer fallback
      if (!queues) {
        setInterval(() => {
          runCleanupTasks().catch(err => logger.error('Scheduled DB hygiene error:', err));
        }, 24 * 60 * 60 * 1000);
        require('./services/subAdminJobs').startFallbackScheduler();
      }
      // NOTE: the admin operations report is no longer auto-scheduled — it's
      // generated on demand from Admin > Operations Report (a date-range
      // tool) via POST /api/admin/reports/generate.
    });

    return serverInstance;

  } catch (error) {
    logger.error('Failed to start server:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

let server;
startServer().then(instance => {
  server = instance;
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Close database connection
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', { error: error.message });
  }

  process.exit(signal === 'uncaughtException' ? 1 : 0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.code === 'ECONNREFUSED') {
    // Suppress verbose Redis connection retry errors when Redis is down
    return;
  }
  logger.error('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    promise
  });
});
