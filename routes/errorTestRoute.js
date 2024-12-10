const express = require('express');
const { simulateDatabaseError, simulateUnauthorizedAccess, simulateForbiddenAccess } = require('../middleware/specificErrorMiddleware');
const { isAuthenticated } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/simulate-db-error', simulateDatabaseError, (req, res) => {
    res.send('If you see this, the database query succeeded.');
});

router.get('/simulate-unauthorized', simulateUnauthorizedAccess, (req, res) => {
    res.send('If you see this, you are authorized.');
});

router.get('/simulate-forbidden', simulateForbiddenAccess, (req, res) => {
    res.send('If you see this, you are permitted to access this resource.');
});

module.exports = router;
