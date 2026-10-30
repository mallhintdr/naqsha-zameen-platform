const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

/**
 * Escape regex special characters to prevent ReDoS
 */
const escapeRegex = (str) => {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Matches User.js pre-save rules: >= 8 chars, upper, lower, digit, special char
const PASSWORD_STRENGTH_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?])/;
const PASSWORD_STRENGTH_MSG = 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character';

/**
 * Validation rules for user registration
 */
const registerValidation = [
    body('userId')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('User ID must be 3-50 characters')
        .matches(/^[a-zA-Z0-9_.-]+$/)
        .withMessage('User ID can only contain letters, numbers, dots, underscores, and hyphens'),

    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(PASSWORD_STRENGTH_REGEX)
        .withMessage(PASSWORD_STRENGTH_MSG),

    body('userName')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('User name must be less than 100 characters'),

    body('email')
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail()
        .withMessage('Invalid email address'),

    body('mobileNumber')
        .optional()
        .matches(/^(\+|00|0)?[0-9\-\s]{5,20}$/)
        .withMessage('Invalid mobile number format'),

    body('subscriptionType')
        .optional()
        .isIn(['Trial', 'Weekly', 'Monthly', 'Quarterly', 'Biannual', 'Annual', 'Permanent'])
        .withMessage('Invalid subscription type'),

    validate
];

/**
 * Validation rules for login
 */
const loginValidation = [
    body('userId')
        .trim()
        .notEmpty()
        .withMessage('User ID is required')
        .isLength({ max: 50 })
        .withMessage('User ID too long'),

    body('password')
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ max: 128 })
        .withMessage('Password too long'),

    validate
];

/**
 * Validation rules for password change
 */
const changePasswordValidation = [
    body('oldPassword')
        .notEmpty()
        .withMessage('Old password is required'),

    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters long')
        .matches(PASSWORD_STRENGTH_REGEX)
        .withMessage(PASSWORD_STRENGTH_MSG),

    validate
];

/**
 * Validation rules for password reset
 */
const resetPasswordValidation = [
    body('token')
        .notEmpty()
        .withMessage('Reset token is required'),

    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(PASSWORD_STRENGTH_REGEX)
        .withMessage(PASSWORD_STRENGTH_MSG),

    validate
];

/**
 * Validation rules for user update
 */
const updateUserValidation = [
    param('userId')
        .trim()
        .notEmpty()
        .withMessage('User ID is required'),

    body('password')
        .optional()
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(PASSWORD_STRENGTH_REGEX)
        .withMessage(PASSWORD_STRENGTH_MSG),

    body('email')
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail()
        .withMessage('Invalid email address'),

    body('mobileNumber')
        .optional()
        .matches(/^(\+|00|0)?[0-9\-\s]{5,20}$/)
        .withMessage('Invalid mobile number format'),

    validate
];

/**
 * Validation rules for search query
 */
const searchValidation = [
    query('query')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Search query too long')
        .customSanitizer(escapeRegex),

    validate
];

/**
 * Validation rules for pagination
 */
const paginationValidation = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),

    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),

    validate
];

/**
 * Validation rules for path parameters (tehsil, mauza)
 */
const pathParamValidation = [
    param('tehsil')
        .trim()
        .matches(/^[\p{L}\p{N}\s_.,()+-]+$/u)
        .withMessage('Invalid tehsil name')
        .isLength({ max: 100 })
        .withMessage('Tehsil name too long'),

    param('mauza')
        .optional()
        .trim()
        .matches(/^[\p{L}\p{N}\s_.,()+-]+$/u)
        .withMessage('Invalid mauza name')
        .isLength({ max: 100 })
        .withMessage('Mauza name too long'),

    param('mouza')
        .optional()
        .trim()
        .matches(/^[\p{L}\p{N}\s_.,()+-]+$/u)
        .withMessage('Invalid mouza name')
        .isLength({ max: 100 })
        .withMessage('Mouza name too long'),

    validate
];

const emailUpdateValidation = [
    body('email')
        .notEmpty()
        .withMessage('Email address is required')
        .isEmail()
        .normalizeEmail()
        .withMessage('Invalid email address'),
    validate
];

/**
 * Cap the serialized size of a user-supplied geojson payload.
 */
const GEOJSON_MAX_BYTES = 1024 * 1024; // 1MB

const geojsonSizeCheck = (value) => {
    let size;
    try {
        size = Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (e) {
        throw new Error('Invalid geojson payload');
    }
    if (size > GEOJSON_MAX_BYTES) {
        throw new Error('GeoJSON payload too large (max 1MB)');
    }
    return true;
};

/**
 * Validation rules for creating a user layer
 */
const createUserLayerValidation = [
    body('name')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Layer name must be 1-100 characters'),
    body('geojson')
        .exists({ checkNull: true })
        .withMessage('geojson is required')
        .bail()
        .custom((v) => typeof v === 'object')
        .withMessage('geojson must be an object')
        .bail()
        .custom(geojsonSizeCheck),
    validate
];

/**
 * Validation rules for updating a user layer (partial update allowed)
 */
const updateUserLayerValidation = [
    param('id').isMongoId().withMessage('Invalid layer id'),
    body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Layer name must be 1-100 characters'),
    body('geojson')
        .optional()
        .custom((v) => typeof v === 'object')
        .withMessage('geojson must be an object')
        .bail()
        .custom(geojsonSizeCheck),
    validate
];

/**
 * Validation rule for a Mongo ObjectId path param named "id"
 */
const layerIdValidation = [
    param('id').isMongoId().withMessage('Invalid layer id'),
    validate
];

/**
 * Validation rule for the numeric khewatId path param
 */
const recordDetailsValidation = [
    param('khewatId')
        .isInt({ min: 1 })
        .withMessage('Invalid khewat id'),
    validate
];

module.exports = {
    validate,
    escapeRegex,
    registerValidation,
    loginValidation,
    changePasswordValidation,
    resetPasswordValidation,
    updateUserValidation,
    emailUpdateValidation,
    searchValidation,
    paginationValidation,
    pathParamValidation,
    createUserLayerValidation,
    updateUserLayerValidation,
    layerIdValidation,
    recordDetailsValidation,
};
