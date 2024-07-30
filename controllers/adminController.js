const db = require('../config/db');
const nodemailer = require('nodemailer');

const adminController = {
    adminDashboard: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM organizations WHERE deleted = false');
            const applications = result.rows;
            res.render('admin/dashboard', { title: 'Admin Dashboard', applications, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching applications:', error);
            req.flash('error', 'Error fetching applications.');
            res.render('admin/dashboard', { title: 'Admin Dashboard', applications: [], messages: req.flash() });
        }
    },

    holdOrganization: async (req, res) => {
        const { orgId } = req.body;
        try {
            const result = await db.query('UPDATE organizations SET on_hold = true WHERE organization_id = $1 RETURNING email, first_name, last_name', [orgId]);
            const organization = result.rows[0];

            req.flash('success', 'Organization put on hold successfully.');

            // Send notification email to the organization
            await sendEmailNotification(organization.email, 'Your organization has been put on hold', `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been temporarily put on hold. Please contact us for further information.\n\nBest regards,\nAdmin Team`);

            res.redirect('/admin');
        } catch (error) {
            console.error('Error putting organization on hold:', error);
            req.flash('error', 'Failed to put organization on hold.');
            res.redirect('/admin');
        }
    },

    resumeOrganization: async (req, res) => {
        const { orgId } = req.body;
        try {
            const result = await db.query('UPDATE organizations SET on_hold = false WHERE organization_id = $1 RETURNING email, first_name, last_name', [orgId]);
            const organization = result.rows[0];

            req.flash('success', 'Organization resumed successfully.');

            // Send notification email to the organization
            await sendEmailNotification(organization.email, 'Your organization has been resumed', `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been resumed. You can continue using the platform.\n\nBest regards,\nAdmin Team`);

            res.redirect('/admin');
        } catch (error) {
            console.error('Error resuming organization:', error);
            req.flash('error', 'Failed to resume organization.');
            res.redirect('/admin');
        }
    },

    deleteOrganization: async (req, res) => {
        const { orgId } = req.body;
        try {
            const result = await db.query('UPDATE organizations SET deleted = true WHERE organization_id = $1 RETURNING email, first_name, last_name', [orgId]);
            const organization = result.rows[0];

            req.flash('success', 'Organization deleted successfully.');

            // Send notification email to the organization
            await sendEmailNotification(organization.email, 'Your organization has been deleted', `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization has been deleted from our records. If you believe this is a mistake, please contact us.\n\nBest regards,\nAdmin Team`);

            res.redirect('/admin');
        } catch (error) {
            console.error('Error deleting organization:', error);
            req.flash('error', 'Failed to delete organization.');
            res.redirect('/admin');
        }
    },

    superAdminDashboard: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM organizations WHERE deleted = true');
            const deletedAccounts = result.rows;
            res.render('admin/superDashboard', { title: 'Super Admin Dashboard', deletedAccounts, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching deleted accounts:', error);
            req.flash('error', 'Error fetching deleted accounts.');
            res.render('admin/superDashboard', { title: 'Super Admin Dashboard', deletedAccounts: [], messages: req.flash() });
        }
    },

    restoreOrganization: async (req, res) => {
        const { orgId } = req.body;
        try {
            const result = await db.query('UPDATE organizations SET deleted = false WHERE organization_id = $1 RETURNING email, first_name, last_name', [orgId]);
            const organization = result.rows[0];

            req.flash('success', 'Organization restored successfully.');

            // Send notification email to the organization
            await sendEmailNotification(organization.email, 'Your organization has been restored', `Dear ${organization.first_name} ${organization.last_name},\n\nWe apologize for any inconvenience caused. Your organization has been restored and all information is back as it was. You can continue using the platform.\n\nBest regards,\nAdmin Team`);

            res.redirect('/admin/superDashboard');
        } catch (error) {
            console.error('Error restoring organization:', error);
            req.flash('error', 'Failed to restore organization.');
            res.redirect('/admin/superDashboard');
        }
    },

    permanentlyDeleteOrganization: async (req, res) => {
        const { orgId } = req.body;
        try {
            await db.query('DELETE FROM organizations WHERE organization_id = $1', [orgId]);
            req.flash('success', 'Organization permanently deleted successfully.');
            res.redirect('/admin/superDashboard');
        } catch (error) {
            console.error('Error permanently deleting organization:', error);
            req.flash('error', 'Failed to permanently delete organization.');
            res.redirect('/admin/superDashboard');
        }
    }
};

async function sendEmailNotification(to, subject, text) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.ADMIN_NOTIFY_EMAIL_USER,
            pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: process.env.ADMIN_NOTIFY_EMAIL_USER,
        to,
        subject,
        text
    };

    await transporter.sendMail(mailOptions);
}

module.exports = adminController;
