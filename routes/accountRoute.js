const express = require('express');
const bcrypt = require('bcrypt');
const flash = require('connect-flash');
const session = require('express-session');
const multer = require('multer');

module.exports = function (app, pool) {
    app.use(session({
        secret: 'YourSecret',
        resave: false,
        saveUninitialized: false
    }));
    app.use(flash());

    const upload = multer({ dest: 'uploads/' });

    // Registration Route
    app.get('/account/register', (req, res) => {
        res.render('account/register', { title: 'Register', messages: req.flash() });
    });

    app.post('/account/register', upload.fields([{ name: 'proof1', maxCount: 1 }, { name: 'proof2', maxCount: 1 }]), async (req, res) => {
        const { firstName, lastName, email, password, orgName, orgAddress, orgPhone } = req.body;
        if (!password) {
            req.flash('error', 'Password is required.');
            return res.redirect('/account/register');
        }

        try {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const proof1 = req.files['proof1'] ? req.files['proof1'][0].path : null;
            const proof2 = req.files['proof2'] ? req.files['proof2'][0].path : null;

            await pool.query(
                'INSERT INTO organizations (organization_name, organization_address, organization_phone, proof_of_existence_1, proof_of_existence_2, email, password, first_name, last_name, approved) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [orgName, orgAddress, orgPhone, proof1, proof2, email, hashedPassword, firstName, lastName, false]
            );

            req.flash('success', 'Registration successful. Your organization needs to be approved before you can log in. Look forward to an email confirming your approval. If declined, you will be required to provide additional proof for confirmation.');
            res.redirect('/account/login');
        } catch (error) {
            console.error('Error registering organization:', error);
            req.flash('error', 'Registration failed. Please try again.');
            res.redirect('/account/register');
        }
    });

    // Login Route
    app.get('/account/login', (req, res) => {
        res.render('account/login', { title: 'Login', messages: req.flash() });
    });

    app.post('/account/login', async (req, res) => {
        const { email, password } = req.body;
        try {
            const orgResult = await pool.query('SELECT * FROM organizations WHERE email = $1', [email]);
            if (orgResult.rows.length === 0) {
                req.flash('error', 'Invalid email or password.');
                res.redirect('/account/login');
                return;
            }

            const organization = orgResult.rows[0];
            const match = await bcrypt.compare(password, organization.password);
            if (!match) {
                req.flash('error', 'Invalid email or password.');
                res.redirect('/account/login');
                return;
            }

            if (!organization.approved) {
                req.flash('error', 'Your organization account is not yet approved.');
                res.redirect('/account/login');
                return;
            }

            req.session.organizationId = organization.organization_id;
            req.session.organizationName = organization.organization_name;
            req.session.firstName = organization.first_name;
            req.session.lastName = organization.last_name;
            res.redirect('/common/orgDashboard');
        } catch (error) {
            console.error('Error logging in:', error);
            req.flash('error', 'Login failed. Please try again.');
            res.redirect('/account/login');
        }
    });

    // Logout Route
    app.get('/account/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
                console.error('Error logging out:', err);
                req.flash('error', 'Failed to log out. Please try again.');
                res.redirect('/common/orgDashboard');
            } else {
                res.redirect('/account/login');
            }
        });
    });

    // Account Route
    app.get('/account', (req, res) => {
        if (!req.session.organizationId) {
            req.flash('error', 'Please log in to view your account.');
            res.redirect('/account/login');
            return;
        }
        res.render('account/account', { title: 'Account Management', messages: req.flash() });
    });

    // Update Account Route
    app.get('/account/update', async (req, res) => {
        if (!req.session.organizationId) {
            req.flash('error', 'Please log in to update your account.');
            res.redirect('/account/login');
            return;
        }

        try {
            const result = await pool.query('SELECT * FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
            const orgDetails = result.rows[0];
            res.render('account/update', { title: 'Update Account Information', orgDetails, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching organization details:', error);
            req.flash('error', 'Failed to load account information. Please try again.');
            res.redirect('/account');
        }
    });

    app.post('/account/update', async (req, res) => {
        const { firstName, lastName, email, orgName, orgAddress, orgPhone } = req.body;
        const orgId = req.session.organizationId;

        try {
            await pool.query(
                'UPDATE organizations SET first_name = $1, last_name = $2, email = $3, organization_name = $4, organization_address = $5, organization_phone = $6 WHERE organization_id = $7',
                [firstName, lastName, email, orgName, orgAddress, orgPhone, orgId]
            );
            req.flash('success', 'Account information updated successfully.');
            res.redirect('/account');
        } catch (error) {
            console.error('Error updating account:', error);
            req.flash('error', 'Failed to update account information. Please try again.');
            res.redirect('/account/update');
        }
    });

    // Account Personalization Route
    app.get('/account/personalization', async (req, res) => {
        if (!req.session.organizationId) {
            req.flash('error', 'Please log in to personalize your account.');
            res.redirect('/account/login');
            return;
        }

        try {
            const result = await pool.query('SELECT * FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
            const orgDetails = result.rows[0];
            res.render('account/accountPersonalization', { title: 'Account Personalization', orgDetails, messages: req.flash() });
        } catch (error) {
            console.error('Error fetching organization details:', error);
            req.flash('error', 'Failed to load personalization settings. Please try again.');
            res.redirect('/account');
        }
    });

    app.post('/account/personalization', upload.single('logo'), async (req, res) => {
        const { primaryColor, fontStyle } = req.body;
        const logoUrl = req.file ? req.file.path : null;
        const orgId = req.session.organizationId;

        try {
            await pool.query(
                'UPDATE organizations SET primary_color = $1, font_style = $2, logo_url = $3 WHERE organization_id = $4',
                [primaryColor, fontStyle, logoUrl, orgId]
            );
            req.flash('success', 'Account personalization updated successfully.');
            res.redirect('/account');
        } catch (error) {
            console.error('Error updating account personalization:', error);
            req.flash('error', 'Failed to update account personalization. Please try again.');
            res.redirect('/account/accountPersonalization');
        }
    });
};
