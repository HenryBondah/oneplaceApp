// middleware/setCurrentTerm.js
const setCurrentTerm = async (req, res, next) => {
    const { organizationId } = req.session;

    if (!organizationId) {
        return next(); // Skip if no organizationId
    }

    try {
        const currentTermResult = await req.db.query(`
            SELECT term_id, term_name
            FROM terms
            WHERE organization_id = $1 AND start_date <= NOW() AND end_date >= NOW()
            ORDER BY start_date DESC LIMIT 1
        `, [organizationId]);

        if (currentTermResult.rows.length > 0) {
            res.locals.currentTerm = currentTermResult.rows[0];
        } else {
            res.locals.currentTerm = null; // No current term found
        }
    } catch (error) {
        console.error('Error fetching current term:', error);
        res.locals.currentTerm = null;
    }

    next();
};

module.exports = setCurrentTerm;
