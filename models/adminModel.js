const pool = require('../db'); // Import the pool from db.js

const adminModel = {
    approveApplication: async (orgId) => {
        const query = 'UPDATE applications SET status = $1 WHERE organization_id = $2';
        const values = ['approved', orgId];
        await pool.query(query, values);
    },
    declineApplication: async (orgId) => {
        const query = 'UPDATE applications SET status = $1 WHERE organization_id = $2';
        const values = ['declined', orgId];
        await pool.query(query, values);
    },
    putOnHold: async (orgId) => {
        const query = 'UPDATE applications SET status = $1 WHERE organization_id = $2';
        const values = ['on_hold', orgId];
        await pool.query(query, values);
    },
    resumeApplication: async (orgId) => {
        const query = 'UPDATE applications SET status = $1 WHERE organization_id = $2';
        const values = ['resumed', orgId];
        await pool.query(query, values);
    },
    deleteApplication: async (orgId) => {
        const query = 'DELETE FROM applications WHERE organization_id = $1';
        const values = [orgId];
        await pool.query(query, values);
    },
    restoreDeletedAccount: async (orgId) => {
        const query = 'UPDATE organizations SET deleted = false WHERE organization_id = $1';
        const values = [orgId];
        await pool.query(query, values);
    },
    permanentlyDeleteAccount: async (orgId) => {
        const query = 'DELETE FROM organizations WHERE organization_id = $1';
        const values = [orgId];
        await pool.query(query, values);
    }
};

module.exports = adminModel;
