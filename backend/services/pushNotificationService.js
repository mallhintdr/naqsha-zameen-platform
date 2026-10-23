const webpush = require('web-push');
const logger = require('../utils/logger');

/**
 * Web Push (notifications in the phone / desktop status bar, even when the app
 * is closed).
 *
 * The VAPID key pair must stay the same forever: every browser subscription is
 * tied to the public key. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in
 * .env; without them a pair is generated ONCE and stored in the database
 * (SystemConfig 'vapidKeys'), so restarts and all pm2 instances share it.
 * (Previously a new random pair was made on every start, which silently broke
 * every subscription.)
 */
let publicKey = null;
let ready = null;

async function loadKeys() {
    let pub = process.env.VAPID_PUBLIC_KEY;
    let priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
        const SystemConfig = require('../models/SystemConfig');
        const fresh = webpush.generateVAPIDKeys();
        // $setOnInsert: the first instance to start wins; the others read its keys.
        await SystemConfig.updateOne({ key: 'vapidKeys' }, { $setOnInsert: { value: fresh } }, { upsert: true }).catch(() => {});
        const doc = await SystemConfig.findOne({ key: 'vapidKeys' }).lean();
        pub = doc?.value?.publicKey || fresh.publicKey;
        priv = doc?.value?.privateKey || fresh.privateKey;
    }
    webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:admin@naqsha-zameen.pk', pub, priv);
    publicKey = pub;
    logger.info('Web Push ready');
    return pub;
}

const init = () => {
    ready = loadKeys().catch(err => { logger.warn('Web Push init failed', { error: err.message }); return null; });
    return ready;
};

/** Public key for browsers to subscribe with. */
const getPublicKey = async () => publicKey || (ready ? await ready : await init());

/** Sends one push. Returns false when the subscription is gone (remove it). */
const sendPushNotification = async (subscription, payload) => {
    try {
        if (!publicKey) await getPublicKey();
        await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
        return true;
    } catch (error) {
        if (error.statusCode === 410 || error.statusCode === 404) return false;   // unsubscribed / expired
        if (error.statusCode === 401 || error.statusCode === 403) return false;   // made with old keys: drop it, the device re-subscribes
        logger.warn('Push send failed', { status: error.statusCode, error: error.message });
        return true;
    }
};

module.exports = { init, getPublicKey, sendPushNotification };
