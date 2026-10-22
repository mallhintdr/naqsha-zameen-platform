const mongoose = require('mongoose');

const demoLinkSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
    useCount: { type: Number, default: 0 },
    maxUses: { type: Number, default: 5 }
});

const DemoLink = mongoose.model('DemoLink', demoLinkSchema);
module.exports = DemoLink;
