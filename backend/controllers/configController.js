const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

// Get all configs (Admin only)
exports.getConfig = async (req, res) => {
    try {
        const configs = await SystemConfig.find({});
        const configMap = {};
        configs.forEach(c => {
            configMap[c.key] = c.value;
        });
        
        // Defaults if not set
        if (configMap.limitsEnabled === undefined) configMap.limitsEnabled = true;
        if (configMap.mouzaInvoicesEnabled === undefined) configMap.mouzaInvoicesEnabled = false;

        res.json(configMap);
    } catch (error) {
        logger.error('Error fetching config:', error);
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
};

// Update a config (Admin only)
exports.updateConfig = async (req, res) => {
    try {
        const updates = req.body; // e.g. { limitsEnabled: false }
        
        for (const [key, value] of Object.entries(updates)) {
            await SystemConfig.findOneAndUpdate(
                { key },
                { value },
                { upsert: true, new: true }
            );
        }
        
        res.json({ message: 'Configuration updated successfully' });
    } catch (error) {
        logger.error('Error updating config:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
};

// Get public config
exports.getPublicConfig = async (req, res) => {
    try {
        const limitsConfig = await SystemConfig.findOne({ key: 'limitsEnabled' });
        const limitsEnabled = limitsConfig ? limitsConfig.value : true; // Default true
        
        res.json({ limitsEnabled });
    } catch (error) {
        logger.error('Error fetching public config:', error);
        res.status(500).json({ error: 'Failed to fetch public configuration' });
    }
};
