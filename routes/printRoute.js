const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware'); // Ensure correct path to middleware

module.exports = (db) => {
    const printController = require('../controllers/printController')(db);

    router.get('/printStudentReport', isAuthenticated, printController.printStudentReport);
    router.get('/remarks', isAuthenticated, printController.remarksPage);
    router.post('/saveRemarks', isAuthenticated, printController.saveRemarks);
    router.post('/deleteRemarks/:id', isAuthenticated, printController.deleteRemarks);
    router.get('/editRemarks/:id', isAuthenticated, printController.editRemarks);
    router.post('/updateRemarks', isAuthenticated, printController.updateRemarks);

    return router;
};
