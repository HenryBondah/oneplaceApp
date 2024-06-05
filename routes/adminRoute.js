const express = require('express');
const flash = require('connect-flash');
const session = require('express-session');

module.exports = function (app, pool) {
    app.use(session({
        secret: 'YourSecret',
        resave: false,
        saveUninitialized: false
    }));
    app.use(flash());

    // Admin Dashboard Route
    app.get('/admin/', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM organizations WHERE approved = false AND deleted = false');
            const applications = result.rows;
            res.render('admin/dashboard', { title: 'Admin Dashboard', applications: applications, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching applications:', error);
            req.flash('error', 'Error fetching applications.');
            res.render('admin/dashboard', { title: 'Admin Dashboard', applications: [], messages: req.flash() });
        }
    });

    // Admin Action Page Route
    app.get('/admin/action-page', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM organizations WHERE deleted = false');
            const applications = result.rows;
            res.render('admin/action-page', { title: 'Admin Action Page', applications: applications, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching applications:', error);
            req.flash('error', 'Error fetching applications.');
            res.render('admin/action-page', { title: 'Admin Action Page', applications: [], messages: req.flash() });
        }
    });

    // Approve Organization Route
    app.post('/admin/approve', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET approved = true, review_timestamp = CURRENT_TIMESTAMP WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization approved successfully.');
            res.redirect('/admin/');
        } catch (error) {
            console.error('Error approving organization:', error);
            req.flash('error', 'Failed to approve organization.');
            res.redirect('/admin/');
        }
    });

    // Decline Organization Route
    app.post('/admin/decline', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET approved = false, review_timestamp = CURRENT_TIMESTAMP WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization declined successfully.');
            res.redirect('/admin/');
        } catch (error) {
            console.error('Error declining organization:', error);
            req.flash('error', 'Failed to decline organization.');
            res.redirect('/admin/');
        }
    });

    // Put On Hold Organization Route
    app.post('/admin/hold', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET on_hold = true WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization put on hold successfully.');
            res.redirect('/admin/action-page');
        } catch (error) {
            console.error('Error putting organization on hold:', error);
            req.flash('error', 'Failed to put organization on hold.');
            res.redirect('/admin/action-page');
        }
    });

    // Resume Organization Route
    app.post('/admin/resume', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET on_hold = false WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization resumed successfully.');
            res.redirect('/admin/action-page');
        } catch (error) {
            console.error('Error resuming organization:', error);
            req.flash('error', 'Failed to resume organization.');
            res.redirect('/admin/action-page');
        }
    });

    // Delete Organization Route
    app.post('/admin/delete', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET deleted = true WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization deleted successfully.');
            res.redirect('/admin/');
        } catch (error) {
            console.error('Error deleting organization:', error);
            req.flash('error', 'Failed to delete organization.');
            res.redirect('/admin/');
        }
    });

    // Super Admin Dashboard Route
    app.get('/admin/superDashboard', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM organizations WHERE deleted = true');
            const deletedAccounts = result.rows;
            res.render('admin/superDashboard', { title: 'Super Admin Dashboard', deletedAccounts: deletedAccounts, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching deleted accounts:', error);
            req.flash('error', 'Error fetching deleted accounts.');
            res.render('admin/superDashboard', { title: 'Super Admin Dashboard', deletedAccounts: [], messages: req.flash() });
        }
    });

    // Restore Organization Route
    app.post('/admin/restore', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('UPDATE organizations SET deleted = false WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization restored successfully.');
            res.redirect('/admin/superDashboard');
        } catch (error) {
            console.error('Error restoring organization:', error);
            req.flash('error', 'Failed to restore organization.');
            res.redirect('/admin/superDashboard');
        }
    });

    // Permanently Delete Organization Route
    app.post('/admin/permanentlyDelete', async (req, res) => {
        const { orgId } = req.body;
        try {
            await pool.query('DELETE FROM organizations WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization permanently deleted successfully.');
            res.redirect('/admin/superDashboard');
        } catch (error) {
            console.error('Error permanently deleting organization:', error);
            req.flash('error', 'Failed to permanently delete organization.');
            res.redirect('/admin/superDashboard');
        }
    });
};
