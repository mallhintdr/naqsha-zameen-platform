const mongoose = require('mongoose');

const landRecordSchema = new mongoose.Schema({
    tehsil: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Tehsil name is too long']
    },
    mouza: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Mouza name is too long']
    },
    khewatId: {
        type: Number,
        required: true,
        min: [1, 'khewatId must be positive']
    },
    khewatNo: {
        type: String,
        required: true,
        trim: true,
        maxlength: [50, 'khewatNo is too long']
    }
}, {
    strict: false,
    timestamps: true
});

// Index for fast query on tehsil/mouza/khewatNo
landRecordSchema.index({ tehsil: 1, mouza: 1, khewatNo: 1 });
landRecordSchema.index({ khewatId: 1 }, { unique: true });

const LandRecord = mongoose.model('LandRecord', landRecordSchema);
module.exports = LandRecord;
