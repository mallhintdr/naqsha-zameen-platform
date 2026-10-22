const UserLayer = require('../models/UserLayer');

exports.createUserLayer = async (req, res) => {
    const { name, geojson } = req.body;
    if (!name || !geojson) return res.status(400).json({ message: 'Name and geojson required' });

    try {
        const count = await UserLayer.countDocuments({ userId: req.user._id });
        if (count >= 30) return res.status(400).json({ message: 'Layer limit reached' });

        const layer = new UserLayer({ userId: req.user._id, name, geojson });
        await layer.save();
        res.status(201).json(layer);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create layer' });
    }
};

exports.getUserLayers = async (req, res) => {
    try {
        const layers = await UserLayer.find({ userId: req.user._id }).sort('-updatedAt');
        res.json(layers);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch layers' });
    }
};

exports.updateUserLayer = async (req, res) => {
    const { name, geojson } = req.body;
    try {
        const layer = await UserLayer.findOne({ _id: req.params.id, userId: req.user._id });
        if (!layer) return res.status(404).json({ message: 'Layer not found' });
        if (name !== undefined) layer.name = name;
        if (geojson !== undefined) layer.geojson = geojson;
        layer.updatedAt = new Date();
        await layer.save();
        res.json(layer);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update layer' });
    }
};

exports.deleteUserLayer = async (req, res) => {
    try {
        const layer = await UserLayer.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!layer) return res.status(404).json({ message: 'Layer not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete layer' });
    }
};
