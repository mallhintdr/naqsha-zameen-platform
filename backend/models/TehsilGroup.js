const mongoose = require('mongoose');

const tehsilGroupSchema = new mongoose.Schema({
    canonicalName: {
        type: String,
        required: true,
        trim: true
    },
    aliases: [{
        type: String,
        required: true,
        trim: true
    }],
    updatedBy: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Case-insensitive indexing on aliases for rapid lookups
tehsilGroupSchema.index({ aliases: 1 });

const TehsilGroup = mongoose.model('TehsilGroup', tehsilGroupSchema);
module.exports = TehsilGroup;
