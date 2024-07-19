const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware'); // Ensure correct path to middleware

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

    router.get('/printStudentReport', isAuthenticated, printController.printStudentReport);
    router.get('/remarks', isAuthenticated, printController.remarksPage);
    router.post('/saveRemarks', isAuthenticated, printController.saveRemarks);
    router.post('/uploadSignatureImage', isAuthenticated, upload.single('signatureImage'), printController.uploadSignatureImage); // Add this route
    router.post('/deleteRemarks/:id', isAuthenticated, printController.deleteRemarks);
    router.get('/editRemarks/:id', isAuthenticated, printController.editRemarks);
    router.post('/updateRemarks', isAuthenticated, printController.updateRemarks);

    return router;
};
