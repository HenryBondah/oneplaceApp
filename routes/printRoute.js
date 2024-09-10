const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware');
const path = require('path');

const multer = require('multer');

// Use memory storage instead of disk storage
const storage = multer.memoryStorage();  // Files are kept in memory and not saved to disk
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

    // Use `upload.single()` with `multer.memoryStorage` to upload the file to S3
    router.post('/uploadSignatureImage', upload.single('signatureImage'), printController.uploadSignatureImage);

    // Deletion route for the signature image
    router.get('/deleteSignatureImage', isAuthenticated, printController.deleteSignatureImage);
    router.get('/deleteTeacherRemark/:id', isAuthenticated, printController.deleteTeacherRemark);
    router.get('/deleteScoreRemark/:id', isAuthenticated, printController.deleteScoreRemark);

    return router;
};
