const TehsilGroup = require('../models/TehsilGroup');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// Cache alias mappings in memory for 10 minutes
const aliasCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });

/**
 * Get all linked tehsil names (aliases) for a given tehsil name.
 * If the tehsil is part of a group, returns all aliases in that group.
 * Otherwise, returns [tehsilName].
 * 
 * @param {string} tehsilName 
 * @returns {Promise<string[]>}
 */
const getLinkedTehsils = async (tehsilName) => {
    if (!tehsilName || typeof tehsilName !== 'string') return [];
    const trimmed = tehsilName.trim();
    if (!trimmed) return [];

    const cacheKey = `linked:${trimmed.toLowerCase()}`;
    const cached = aliasCache.get(cacheKey);
    if (cached) return cached;

    try {
        const safeRegex = new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const group = await TehsilGroup.findOne({
            $or: [
                { canonicalName: safeRegex },
                { aliases: safeRegex }
            ]
        }).lean();

        let result;
        if (group && Array.isArray(group.aliases) && group.aliases.length > 0) {
            // Deduplicate case-insensitively while preserving first casing
            const seen = new Set();
            result = group.aliases.filter(a => {
                const lower = String(a).toLowerCase();
                if (seen.has(lower)) return false;
                seen.add(lower);
                return true;
            });
            // Ensure the queried tehsil name is present
            if (!seen.has(trimmed.toLowerCase())) {
                result.unshift(trimmed);
            }
        } else {
            result = [trimmed];
        }

        aliasCache.set(cacheKey, result);
        return result;
    } catch (err) {
        logger.error('Error fetching linked tehsils:', { error: err.message, tehsil: tehsilName });
        return [trimmed];
    }
};

/**
 * Get all active Tehsil Groups
 */
const getAllGroups = async () => {
    try {
        const groups = await TehsilGroup.find().sort({ canonicalName: 1 }).lean();
        return groups;
    } catch (err) {
        logger.error('Error fetching all tehsil groups:', { error: err.message });
        return [];
    }
};

/**
 * Save or update a Tehsil Group
 * 
 * @param {string|null} groupId 
 * @param {string} canonicalName 
 * @param {string[]} aliases 
 * @param {string} userId 
 */
const saveGroup = async (groupId, canonicalName, aliases, userId) => {
    if (!canonicalName || !Array.isArray(aliases) || aliases.length < 2) {
        throw new Error('A group requires a canonical name and at least 2 linked tehsils.');
    }

    const cleanAliases = Array.from(
        new Set(aliases.map(a => String(a).trim()).filter(Boolean))
    );

    if (cleanAliases.length < 2) {
        throw new Error('At least 2 distinct tehsil names are required.');
    }

    // Check if any of these aliases are already in another group
    const duplicateQuery = {
        aliases: { $in: cleanAliases.map(a => new RegExp(`^${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
    };
    if (groupId) {
        duplicateQuery._id = { $ne: groupId };
    }

    const existingConflict = await TehsilGroup.findOne(duplicateQuery).lean();
    if (existingConflict) {
        throw new Error(`One or more tehsils are already linked in the group "${existingConflict.canonicalName}".`);
    }

    let saved;
    if (groupId) {
        saved = await TehsilGroup.findByIdAndUpdate(
            groupId,
            {
                canonicalName: canonicalName.trim(),
                aliases: cleanAliases,
                updatedBy: userId
            },
            { new: true, runValidators: true }
        );
    } else {
        saved = await TehsilGroup.create({
            canonicalName: canonicalName.trim(),
            aliases: cleanAliases,
            updatedBy: userId
        });
    }

    invalidateCache();
    return saved;
};

/**
 * Delete / Unlink a Tehsil Group
 * 
 * @param {string} groupId 
 */
const deleteGroup = async (groupId) => {
    const deleted = await TehsilGroup.findByIdAndDelete(groupId);
    invalidateCache();
    return deleted;
};

/**
 * Invalidate in-memory alias cache
 */
// Linked-tehsil changes must reach ALL server instances (cacheBus).
require('../utils/cacheBus').register('tehsilGroups', () => aliasCache.flushAll());
const invalidateCache = () => { require('../utils/cacheBus').bump('tehsilGroups'); };

module.exports = {
    getLinkedTehsils,
    getAllGroups,
    saveGroup,
    deleteGroup,
    invalidateCache
};
