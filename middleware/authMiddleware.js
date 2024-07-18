// middleware/authMiddleware.js

const db = require('../config/db');

const isAuthenticated = (req, res, next) => {
    if (req.session.organizationId || req.session.userId) {
        return next();
    } else {
        res.redirect('/account/login');
    }
};

const fetchOrganizationInfo = async (req, res, next) => {
    if (req.session.userId) {
        try {
            const result = await db.query(`
                SELECT u.first_name, o.organization_id, o.organization_name, o.logo, o.font_style 
                FROM users u 
                JOIN organizations o ON u.organization_id = o.organization_id 
                WHERE u.user_id = $1
            `, [req.session.userId]);
            if (result.rows.length > 0) {
                req.session.organizationId = result.rows[0].organization_id;
                req.session.organizationName = result.rows[0].organization_name;
                req.session.firstName = result.rows[0].first_name;
                req.session.logo = result.rows[0].logo;
                req.session.fontStyle = result.rows[0].font_style;
            }
            next();
        } catch (err) {
            console.error('Error fetching organization info:', err);
            next(err);
        }
    } else {
        next();
    }
};

const checkOrganizationStatus = async (req, res, next) => {
    if (req.session.organizationId) {
        try {
            const result = await db.query('SELECT on_hold, deleted FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
            const organization = result.rows[0];

            if (organization.on_hold || organization.deleted) {
                req.session.destroy(err => {
                    if (err) {
                        console.error('Error logging out:', err);
                    }
                    res.redirect('/account/login');
                });
            } else {
                next();
            }
        } catch (error) {
            console.error('Error checking organization status:', error);
            req.flash('error', 'An error occurred. Please try again.');
            res.redirect('/account/login');
        }
    } else {
        next();
    }
};

module.exports = {
    isAuthenticated,
    fetchOrganizationInfo,
    checkOrganizationStatus
};
