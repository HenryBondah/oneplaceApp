const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

module.exports = (db) => {
    const printController = require('../controllers/printController')(db);

    // Ensure controller methods are defined before using them in routes
    if (!printController || typeof printController.printStudentReport !== 'function') {
        throw new Error('printController is not properly initialized');
    }

    // Route definitions
    router.get('/printStudentReport', isAuthenticated, printController.printStudentReport);
    router.get('/reportSettings', isAuthenticated, printController.reportSettingsPage);
    router.post('/savePromotionSettings', isAuthenticated, printController.savePromotionSettings);
    router.post('/saveTeacherRemarks', isAuthenticated, printController.saveTeacherRemarks);
    router.post('/saveScoreRemarks', isAuthenticated, printController.saveScoreRemarks);
    router.post('/uploadSignatureImage', upload.single('signatureImage'), printController.uploadSignatureImage);
    router.get('/deleteSignatureImage', isAuthenticated, printController.deleteSignatureImage);
    router.get('/deleteTeacherRemark/:id', isAuthenticated, printController.deleteTeacherRemark);
    router.get('/deleteScoreRemark/:id', isAuthenticated, printController.deleteScoreRemark);

    return router;
};
