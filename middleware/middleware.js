const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

function isAuthenticated(req, res, next) {
    if (req.session.organizationId || req.session.userId) {
        return next();
    } else {
        res.redirect('/account/login');
    }
}

module.exports = {
    isAuthenticated,
    upload
};
