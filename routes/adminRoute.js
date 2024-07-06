const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

module.exports = (db) => {
    router.get('/', adminController.adminDashboard);
    router.get('/action-page', adminController.adminActionPage);
    router.post('/approve', adminController.approveOrganization);
    router.post('/decline', adminController.declineOrganization);
    router.post('/hold', adminController.holdOrganization);
    router.post('/resume', adminController.resumeOrganization);
    router.post('/delete', adminController.deleteOrganization);
    router.get('/superDashboard', adminController.superAdminDashboard);
    router.post('/restore', adminController.restoreOrganization);
    router.post('/permanentlyDelete', adminController.permanentlyDeleteOrganization);

    return router;
};
