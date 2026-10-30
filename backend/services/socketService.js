const { isAllowedOrigin } = require('../utils/allowedOrigins');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');
const { getRedisClient } = require('./redisClient');
const { getCachedAuthUser } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

const SECRET_KEY = process.env.SECRET_KEY;

let io;

// Simple cookie parser (avoids extra dependency)
const parseCookies = (cookieHeader) => {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
    });
    return cookies;
};

const init = (server, corsOrigin) => {
    io = new Server(server, {
        cors: {
            origin: function (origin, callback) {
                callback(null, isAllowedOrigin(origin));
            },
            methods: ["GET", "POST"],
            credentials: true
        },
        perMessageDeflate: {
            threshold: 1024 // Enable compression for payloads > 1KB (LOW-05)
        }
    });

    const redisClient = getRedisClient();
    if (redisClient) {
        const pubClient = redisClient.duplicate({ enableOfflineQueue: true });
        const subClient = redisClient.duplicate({ enableOfflineQueue: true });
        pubClient.on('error', () => {});
        subClient.on('error', () => {});
        io.adapter(createAdapter(pubClient, subClient));
    }

    // Issue #4: Authenticate socket connections via JWT cookie + DB tokenVersion/userType lookup
    io.use(async (socket, next) => {
        try {
            const cookies = parseCookies(socket.handshake.headers.cookie);
            const token = cookies.authToken;
            if (!token) return next(new Error('Authentication required'));

            const decoded = jwt.verify(token, SECRET_KEY);
            const user = await getCachedAuthUser(decoded.userId);
            if (!user || (decoded.tokenVersion !== undefined && decoded.tokenVersion !== (user.tokenVersion || 0))) {
                return next(new Error('Session expired'));
            }
            if (user.status === 'Suspended') {
                return next(new Error('Account suspended'));
            }
            socket.userId = user.userId;
            socket.userType = user.userType;
            next();
        } catch (err) {
            next(new Error('Invalid or expired token'));
        }
    });

    io.on('connection', (socket) => {
        // Auto-join the authenticated user's room (no client-supplied userId)
        if (socket.userId) {
            socket.join(`user_${socket.userId}`);
        }
        if (socket.userType === 'admin') {
            socket.join('admins');
        }

        socket.on('disconnect', () => {
            // cleanup handled automatically by socket.io
        });
    });

    return io;
};

const emitNotification = (userId, notification) => {
    if (io) {
        io.to(`user_${userId}`).emit('notification', notification);
    }
};

const emitToAdmins = (notification) => {
    if (io) {
        io.to('admins').emit('notification', notification);
    }
};

module.exports = { init, emitNotification, emitToAdmins };
