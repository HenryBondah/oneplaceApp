const multer = require('multer');

const storage = multer.memoryStorage(); // Store files in memory to send to S3

// Configuring multer to accept multiple fields with file inputs
const contentUpload = multer({
    storage,
}).fields([
    { name: 'files', maxCount: 10 }, // Allow up to 10 slideshow images/videos
    { name: 'logo', maxCount: 1 },    // Allow 1 logo file
]);

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.organizationId || req.session.userId) {
        return next();
    } else {
        res.redirect('/account/login');
    }
}

module.exports = {
    isAuthenticated,
    contentUpload
};
