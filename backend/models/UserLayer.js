const mongoose = require('mongoose');

const userLayerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    geojson: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

const UserLayer = mongoose.model('UserLayer', userLayerSchema);
module.exports = UserLayer;
