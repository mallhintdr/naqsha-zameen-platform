const mongoose = require('mongoose');

const geoJsonSchema = new mongoose.Schema({
    tehsil: { type: String, required: true },
    mauza: { type: String, required: true },
    // SCALE-01: lowercased mirrors for indexed exact-match lookups instead of
    // case-insensitive $regex queries (which cannot use the index and force a COLLSCAN).
    tehsilLower: { type: String },
    mauzaLower: { type: String },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        validate: {
            validator: function(v) {
                if (!v || typeof v !== 'object') return false;
                if (!v.type || !v.features || !Array.isArray(v.features)) return false;
                try {
                    const str = JSON.stringify(v);
                    if (str.length > 1024 * 1024) return false; // Max 1MB
                } catch (e) {
                    return false;
                }
                return true;
            },
            message: 'GeoJSON is invalid or exceeds 1MB.'
        }
    }
}, {
    timestamps: true
});

// Indexes for fast querying
geoJsonSchema.index({ tehsil: 1 });
geoJsonSchema.index({ mauza: 1 });
geoJsonSchema.index({ tehsil: 1, mauza: 1 }, { unique: true });
geoJsonSchema.index({ tehsilLower: 1, mauzaLower: 1 });

geoJsonSchema.pre('save', function (next) {
    if (this.isModified('tehsil') || this.isNew) this.tehsilLower = String(this.tehsil || '').toLowerCase();
    if (this.isModified('mauza') || this.isNew) this.mauzaLower = String(this.mauza || '').toLowerCase();
    next();
});

const GeoJson = mongoose.model('GeoJson', geoJsonSchema);
module.exports = GeoJson;
