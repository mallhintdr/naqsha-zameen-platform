const { getAllTehsilsAndMouzas } = require('../services/geoService');
const logger = require('./logger');

function deriveTehsilState(userDoc) {
    const rawAccess = Array.isArray(userDoc?.tehsilAccess) ? userDoc.tehsilAccess : [];
    const seen = new Set();
    const now = new Date();
    const normalized = [];

    rawAccess.forEach((entry) => {
        const tehsil = typeof entry?.tehsil === 'string' ? entry.tehsil.trim() : '';
        if (!tehsil || seen.has(tehsil)) return;
        
        const allTempGrants = Array.isArray(entry.tempGrants) ? entry.tempGrants : [];
        const validTempGrants = [];
        const expiredTempMouzas = new Set();
        
        allTempGrants.forEach(g => {
            if (new Date(g.expiresAt) > now) {
                validTempGrants.push(g);
            } else {
                expiredTempMouzas.add(String(g.mouza).trim());
            }
        });

        const mouzasList = Array.isArray(entry?.mouzas)
            ? Array.from(new Set(entry.mouzas.map((m) => String(m).trim()).filter(Boolean)))
                 .filter(m => !expiredTempMouzas.has(m) && !m.toLowerCase().includes('-complete'))
            : [];
            
        validTempGrants.forEach(g => {
            const mStr = String(g.mouza).trim();
            if (!mouzasList.includes(mStr) && !mStr.toLowerCase().includes('-complete')) {
                mouzasList.push(mStr);
            }
        });

        normalized.push({ tehsil, mouzas: mouzasList, tempGrants: validTempGrants });
        seen.add(tehsil);
    });

    if (!normalized.length) {
        const fallbackTehsil = typeof userDoc?.tehsil === 'string' ? userDoc.tehsil.trim() : '';
        const fallbackMauzas = Array.isArray(userDoc?.mauzaList)
            ? Array.from(new Set(userDoc.mauzaList.map((m) => String(m).trim()).filter(Boolean)))
                 .filter(m => !m.toLowerCase().includes('-complete'))
            : [];
        if (fallbackTehsil) {
            normalized.push({ tehsil: fallbackTehsil, mouzas: fallbackMauzas });
        }
    }

    const requestedActive = typeof userDoc?.activeTehsil === 'string'
        ? userDoc.activeTehsil.trim()
        : '';
    const activeEntry = normalized.find((entry) => entry.tehsil === requestedActive)
        || normalized[0]
        || null;

    return {
        tehsilAccess: normalized,
        activeTehsil: activeEntry?.tehsil || '',
        activeMouzas: activeEntry?.mouzas || []
    };
}

function sanitizeUser(userDoc) {
    if (!userDoc) return userDoc;
    const obj = typeof userDoc.toObject === 'function' ? userDoc.toObject() : { ...userDoc };
    // SEC-02: Never expose password hashes to any client
    delete obj.password;
    delete obj.passwordPlain;
    delete obj.resetPasswordToken;
    delete obj.resetPasswordExpires;
    delete obj.verificationToken;
    delete obj.otp;
    if (obj.activation) { obj.activation = { ...obj.activation }; delete obj.activation.tokenHash; }
    if (obj.pendingEmail) { obj.pendingEmail = { ...obj.pendingEmail }; delete obj.pendingEmail.tokenHash; }
    const { tehsilAccess, activeTehsil, activeMouzas } = deriveTehsilState({ ...obj, ...userDoc });
    obj.tehsilAccess = tehsilAccess;
    obj.activeTehsil = activeTehsil;
    obj.tehsil = activeTehsil; // legacy field for clients expecting single tehsil
    obj.mauzaList = activeMouzas;
    return obj;
}

async function ensureUserTehsilStateAsync(userDoc) {
    if (userDoc && userDoc.userType === 'admin') {
        // If the admin user already has a populated tehsilAccess (e.g. scanned from the frontend),
        // preserve it and do not overwrite it with database records.
        if (Array.isArray(userDoc.tehsilAccess) && userDoc.tehsilAccess.length > 0) {
            // Strip any legacy -complete from existing admin tehsilAccess
            userDoc.tehsilAccess = userDoc.tehsilAccess.map(t => ({
                tehsil: t.tehsil,
                mouzas: (t.mouzas || []).filter(m => !String(m).toLowerCase().includes('-complete')),
                ...(t.tempGrants ? { tempGrants: t.tempGrants } : {})
            }));
            const currentActive = userDoc.activeTehsil;
            const validActive = userDoc.tehsilAccess.find(t => t.tehsil === currentActive);
            const newActive = validActive ? currentActive : userDoc.tehsilAccess[0].tehsil;
            userDoc.activeTehsil = newActive;
            
            const activeEntry = userDoc.tehsilAccess.find(e => e.tehsil === newActive);
            return {
                tehsilAccess: userDoc.tehsilAccess,
                activeTehsil: newActive,
                activeMouzas: activeEntry ? activeEntry.mouzas : [],
                changed: false
            };
        }

        try {
            const allAccess = await getAllTehsilsAndMouzas();

            const currentActive = userDoc.activeTehsil;
            const validActive = allAccess.find(t => t.tehsil === currentActive);
            const newActive = validActive ? currentActive : (allAccess.length > 0 ? allAccess[0].tehsil : '');

            const currentSerialized = JSON.stringify(Array.isArray(userDoc.tehsilAccess) ? userDoc.tehsilAccess : []);
            const newSerialized = JSON.stringify(allAccess);
            let changed = currentSerialized !== newSerialized || (userDoc.activeTehsil || '') !== newActive;

            userDoc.tehsilAccess = allAccess;
            userDoc.activeTehsil = newActive;

            const activeEntry = allAccess.find(e => e.tehsil === newActive);

            return {
                tehsilAccess: allAccess,
                activeTehsil: newActive,
                activeMouzas: activeEntry ? activeEntry.mouzas : [],
                changed
            };

        } catch (err) {
            logger.error('Error ensuring admin tehsil state:', { error: err.message, stack: err.stack });
            return ensureUserTehsilState(userDoc);
        }
    }
    return ensureUserTehsilState(userDoc);
}

function ensureUserTehsilState(userDoc) {
    const state = deriveTehsilState(userDoc);
    const currentSerialized = JSON.stringify(Array.isArray(userDoc?.tehsilAccess) ? userDoc.tehsilAccess : []);
    const newSerialized = JSON.stringify(state.tehsilAccess);
    const changed = currentSerialized !== newSerialized || (userDoc?.activeTehsil || '') !== state.activeTehsil;
    if (userDoc) {
        userDoc.tehsilAccess = state.tehsilAccess;
        userDoc.activeTehsil = state.activeTehsil;
    }
    return { ...state, changed };
}

// SEC-03: Accept fallback parameters for legacy registration fields
function sanitizeTehsilAssignmentsInput(input, { fallbackTehsil, fallbackMauzas } = {}) {
    if (!Array.isArray(input) || input.length === 0) {
        // Handle legacy tehsil/mauzaList fields as fallback
        if (fallbackTehsil && typeof fallbackTehsil === 'string' && fallbackTehsil.trim()) {
            return [{
                tehsil: fallbackTehsil.trim(),
                mouzas: Array.isArray(fallbackMauzas)
                    ? fallbackMauzas.map(m => String(m).trim()).filter(m => m && !m.toLowerCase().includes('-complete'))
                    : []
            }];
        }
        return [];
    }
    return input.map(entry => ({
        tehsil: typeof entry.tehsil === 'string' ? entry.tehsil.trim() : '',
        mouzas: Array.isArray(entry.mouzas)
            ? entry.mouzas.map(m => String(m).trim()).filter(m => m && !m.toLowerCase().includes('-complete'))
            : [],
        tempGrants: Array.isArray(entry.tempGrants)
            ? entry.tempGrants
                .filter(g => g.mouza && g.expiresAt)
                .map(g => ({
                    mouza: String(g.mouza).trim(),
                    expiresAt: new Date(g.expiresAt)
                }))
            : []
    })).filter(e => e.tehsil);
}

function applyTehsilAssignmentsToUser(userDoc, assignments, specificActiveTehsil) {
    const sanitized = sanitizeTehsilAssignmentsInput(assignments);

    // Validate that requested active tehsil is actually in the assignments
    let activeTehsil = '';
    if (specificActiveTehsil) {
        const exists = sanitized.find(e => e.tehsil === specificActiveTehsil);
        if (exists) {
            activeTehsil = specificActiveTehsil;
        }
    }

    // Fallback to first available if none selected or invalid
    if (!activeTehsil && sanitized.length > 0) {
        activeTehsil = sanitized[0].tehsil;
    }

    return {
        tehsilAccess: sanitized,
        activeTehsil
    };
}

// IP-based multi-use counting was replaced by device counting: services/deviceTracker.js

module.exports = {
    deriveTehsilState,
    sanitizeUser,
    ensureUserTehsilState,
    applyTehsilAssignmentsToUser,
    sanitizeTehsilAssignmentsInput,
    ensureUserTehsilStateAsync,
};
