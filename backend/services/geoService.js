const GeoJson = require('../models/GeoJson');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// PERF-04: Cache tehsil/mouza data with 5-minute TTL to avoid repeated DB aggregations
const tehsilCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const getAllTehsilsAndMouzas = async () => {
    try {
        const cached = tehsilCache.get('allTehsilsAndMouzas');
        if (cached) return cached;

        const results = await GeoJson.aggregate([
            {
                $match: {
                    mauza: { $not: { $regex: /-complete/i } }
                }
            },
            {
                $group: {
                    _id: "$tehsil",
                    mouzas: { $addToSet: "$mauza" }
                }
            },
            {
                $project: {
                    _id: 0,
                    tehsil: "$_id",
                    mouzas: {
                        $filter: {
                            input: "$mouzas",
                            as: "m",
                            cond: {
                                $and: [
                                    { $ne: ["$$m", null] },
                                    { $ne: ["$$m", ""] },
                                    {
                                        $not: {
                                            $regexMatch: {
                                                input: "$$m",
                                                regex: "-complete",
                                                options: "i"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            {
                $sort: {
                    tehsil: 1
                }
            }
        ]);

        tehsilCache.set('allTehsilsAndMouzas', results);
        return results;
    } catch (error) {
        logger.error('Error fetching tehsils and mouzas:', { error: error.message, stack: error.stack });
        return [];
    }
};

// Clears the tehsil / mouza list on ALL server instances (cacheBus).
require('../utils/cacheBus').register('geo', () => tehsilCache.flushAll());
const invalidateCache = () => { require('../utils/cacheBus').bump('geo'); };

module.exports = {
    getAllTehsilsAndMouzas,
    invalidateCache
};
