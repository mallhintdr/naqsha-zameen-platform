const tehsilAliasService = require('../services/tehsilAliasService');
const logger = require('../utils/logger');
const TehsilGroup = require('../models/TehsilGroup');
const { splitGroupAccess } = require('../services/tehsilDisplayService');
const lc = (s) => String(s || '').trim().toLowerCase();

exports.getGroups = async (req, res) => {
    try {
        const groups = await tehsilAliasService.getAllGroups();
        res.json(groups);
    } catch (error) {
        logger.error('getGroups error:', { error: error.message });
        res.status(500).json({ message: 'Failed to fetch tehsil groups' });
    }
};

exports.createGroup = async (req, res) => {
    try {
        const { canonicalName, aliases } = req.body;
        const userId = req.user?.userId || 'admin';

        if (!canonicalName || !Array.isArray(aliases) || aliases.length < 2) {
            return res.status(400).json({ message: 'Please provide a group name and at least 2 tehsils to link.' });
        }

        const group = await tehsilAliasService.saveGroup(null, canonicalName, aliases, userId);
        res.status(201).json({ message: 'Tehsil group linked successfully', group });
    } catch (error) {
        logger.error('createGroup error:', { error: error.message });
        res.status(400).json({ message: error.message || 'Failed to create tehsil group' });
    }
};

exports.updateGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const { canonicalName, aliases } = req.body;
        const userId = req.user?.userId || 'admin';

        if (!canonicalName || !Array.isArray(aliases) || aliases.length < 2) {
            return res.status(400).json({ message: 'Please provide a group name and at least 2 tehsils to link.' });
        }

        const before = await TehsilGroup.findById(id).lean();
        const group = await tehsilAliasService.saveGroup(id, canonicalName, aliases, userId);
        if (!group) {
            return res.status(404).json({ message: 'Tehsil group not found' });
        }

        // Keep users' saved access in step with the edited group.
        let moved = null;
        if (before) {
            if (lc(before.canonicalName) !== lc(group.canonicalName)) {
                moved = await splitGroupAccess(before.canonicalName, [], group.canonicalName); // renamed
            }
            const removed = (before.aliases || []).filter(a => !(group.aliases || []).some(b => lc(b) === lc(a)));
            if (removed.length) {
                // Tehsils taken out of the group get back their own entries.
                moved = await splitGroupAccess(group.canonicalName, [group.canonicalName, ...removed]);
            }
        }
        res.json({ message: 'Tehsil group updated successfully', group, usersUpdated: moved?.users || 0 });
    } catch (error) {
        logger.error('updateGroup error:', { error: error.message });
        res.status(400).json({ message: error.message || 'Failed to update tehsil group' });
    }
};

exports.deleteGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const group = await tehsilAliasService.deleteGroup(id);
        if (!group) {
            return res.status(404).json({ message: 'Tehsil group not found' });
        }

        // Users (and sub-admin territories) saved under the group name get the
        // original tehsil names back, so their dropdowns show them again.
        const moved = await splitGroupAccess(group.canonicalName, group.aliases || []);
        res.json({ message: `Tehsils unlinked successfully. ${moved.users} user(s) updated.`, usersUpdated: moved.users });
    } catch (error) {
        logger.error('deleteGroup error:', { error: error.message });
        res.status(500).json({ message: 'Failed to unlink tehsil group' });
    }
};
