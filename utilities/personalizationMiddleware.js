module.exports = function(req, res, next) {
    if (!req.session.organizationId && !['/', '/account/login', '/account/register'].includes(req.path)) {
        req.session.organizationId = 1; // Set your default organization ID here (make sure it's a valid integer)
    }
    next();
};
