const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

module.exports = (db) => {
    router.get('/', adminController.adminDashboard);
    router.post('/hold', adminController.holdOrganization);
    router.post('/resume', adminController.resumeOrganization);
    router.post('/delete', adminController.deleteOrganization);
    router.get('/superDashboard', adminController.superAdminDashboard);
    router.post('/restore', adminController.restoreOrganization);
    router.post('/permanentlyDelete', adminController.permanentlyDeleteOrganization);
    router.get('/superSettings', adminController.superAdminSettings);

    return router;
};
