// enrollmentRoutes.js
const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollmentController'); // Corrected import
const { isAuthenticated } = require('../middleware/middleware');

module.exports = (db) => {
    router.get('/enroll', isAuthenticated, (req, res) => enrollmentController.enrollmentGet(req, res, db));
    router.post('/enroll', isAuthenticated, (req, res) => enrollmentController.enrollmentPost(req, res, db));
    router.get('/getStudentsByClass', isAuthenticated, (req, res) => enrollmentController.getStudentsByClass(req, res, db));

    return router;
};
