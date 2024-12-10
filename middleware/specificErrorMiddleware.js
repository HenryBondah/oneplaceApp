const db = require('../config/db');

const simulateDatabaseError = async (req, res, next) => {
    try {
        // Simulate a database error
        await db.query('SELECT * FROM non_existent_table');
        next();
    } catch (error) {
        next({
            status: 500,
            message: 'Database Error: Failed to retrieve data from the database.',
        });
    }
};

const simulateUnauthorizedAccess = (req, res, next) => {
    if (!req.session.userId) {
        next({
            status: 401,
            message: 'Unauthorized: You need to log in to access this resource.',
        });
    } else {
        next();
    }
};

const simulateForbiddenAccess = (req, res, next) => {
    if (!req.session.isAdmin) {
        next({
            status: 403,
            message: 'Forbidden: You do not have permission to access this resource.',
        });
    } else {
        next();
    }
};

module.exports = {
    simulateDatabaseError,
    simulateUnauthorizedAccess,
    simulateForbiddenAccess,
};
