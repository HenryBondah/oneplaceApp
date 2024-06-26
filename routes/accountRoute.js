// routes/accountRoute.js
const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

module.exports = function(app, pool) {
    const upload = multer({ dest: 'uploads/' });

    // Middleware to check if user is authenticated
    function isAuthenticated(req, res, next) {
        if (req.session.organizationId || req.session.userId) {
            return next();
        } else {
            res.redirect('/account/login');
        }
    }

    // Middleware to check if organization is active (not on hold or deleted)
    async function checkOrganizationStatus(req, res, next) {
        if (req.session.organizationId) {
            try {
                const result = await pool.query('SELECT on_hold, deleted FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
                const organization = result.rows[0];

                if (organization.on_hold || organization.deleted) {
                    req.session.destroy(err => {
                        if (err) {
                            console.error('Error logging out:', err);
                        }
                        res.redirect('/account/login');
                    });
                } else {
                    next();
                }
            } catch (error) {
                console.error('Error checking organization status:', error);
                req.flash('error', 'An error occurred. Please try again.');
                res.redirect('/account/login');
            }
        } else {
            next();
        }
    }

    app.use(require('express-session')({
        secret: 'YourSecret',
        resave: false,
        saveUninitialized: false
    }));

    app.use(require('connect-flash')());
    app.use(checkOrganizationStatus);

    app.get('/account/register', (req, res) => {
        res.render('account/register', { title: 'Register', messages: req.flash() });
    });

    app.post('/account/register', upload.fields([{ name: 'proof1' }, { name: 'proof2' }]), async (req, res) => {
        const { firstName, lastName, email, password, orgName, orgAddress, orgPhone } = req.body;
        const proof1 = req.files['proof1'] ? req.files['proof1'][0].path : '';
        const proof2 = req.files['proof2'] ? req.files['proof2'][0].path : '';
        const hashedPassword = await bcrypt.hash(password, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                'INSERT INTO organizations (organization_name, organization_address, organization_phone, proof_of_existence_1, proof_of_existence_2, email, password, first_name, last_name, approved, on_hold, deleted) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, false) RETURNING organization_id',
                [orgName, orgAddress, orgPhone, proof1, proof2, email, hashedPassword, firstName, lastName]
            );

            const orgId = result.rows[0].organization_id;

            await client.query('COMMIT');
            req.flash('success', 'Registration successful. Please wait for approval.');
            res.redirect('/account/login');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error during registration:', error);
            if (error.code === '23505') {
                req.flash('error', 'Email already exists.');
            } else {
                req.flash('error', 'Registration failed.');
            }
            res.redirect('/account/register');
        } finally {
            client.release();
        }
    });

    app.get('/account/login', (req, res) => {
        res.render('account/login', { title: 'Login', messages: req.flash() });
    });

    app.post('/account/login', async (req, res) => {
        const { email, password } = req.body;
        try {
            const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                const match = await bcrypt.compare(password, user.password);
                if (match) {
                    const orgResult = await pool.query('SELECT organization_name, on_hold, deleted FROM organizations WHERE organization_id = $1', [user.organization_id]);
                    if (orgResult.rows.length > 0) {
                        const organization = orgResult.rows[0];

                        if (organization.on_hold) {
                            req.flash('error', 'Your organization account is currently on hold.');
                            res.redirect('/account/login');
                            return;
                        }

                        if (organization.deleted) {
                            req.flash('error', 'Your organization account has been deleted.');
                            res.redirect('/account/login');
                            return;
                        }

                        req.session.regenerate(err => {
                            if (err) {
                                console.error('Error regenerating session:', err);
                                req.flash('error', 'Login failed. Please try again.');
                                res.redirect('/account/login');
                                return;
                            }

                            req.session.userId = user.user_id;
                            req.session.organizationId = user.organization_id;
                            req.session.firstName = user.first_name;
                            req.session.lastName = user.last_name;
                            req.session.organizationName = organization.organization_name;

                            req.session.save(err => {
                                if (err) {
                                    console.error('Error saving session:', err);
                                    req.flash('error', 'Login failed. Please try again.');
                                    res.redirect('/account/login');
                                } else {
                                    res.redirect('/common/orgDashboard');
                                }
                            });
                        });
                        return;
                    }
                }
            }

            const orgResult = await pool.query('SELECT * FROM organizations WHERE email = $1', [email]);
            if (orgResult.rows.length > 0) {
                const organization = orgResult.rows[0];
                const match = await bcrypt.compare(password, organization.password);
                if (match) {
                    if (organization.on_hold) {
                        req.flash('error', 'Your organization account is currently on hold.');
                        res.redirect('/account/login');
                        return;
                    }

                    if (organization.deleted) {
                        req.flash('error', 'Your organization account has been deleted.');
                        res.redirect('/account/login');
                        return;
                    }

                    req.session.regenerate(err => {
                        if (err) {
                            console.error('Error regenerating session:', err);
                            req.flash('error', 'Login failed. Please try again.');
                            res.redirect('/account/login');
                            return;
                        }

                        req.session.organizationId = organization.organization_id;
                        req.session.organizationName = organization.organization_name;
                        req.session.firstName = organization.first_name;
                        req.session.lastName = organization.last_name;

                        req.session.save(err => {
                            if (err) {
                                console.error('Error saving session:', err);
                                req.flash('error', 'Login failed. Please try again.');
                                res.redirect('/account/login');
                            } else {
                                res.redirect('/common/orgDashboard');
                            }
                        });
                    });
                    return;
                }
            }

            req.flash('error', 'Invalid email or password.');
            res.redirect('/account/login');
        } catch (error) {
            console.error('Error logging in:', error);
            req.flash('error', 'Login failed. Please try again.');
            res.redirect('/account/login');
        }
    });

    app.get('/account/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
                console.error('Error logging out:', err);
                req.flash('error', 'Failed to log out. Please try again.');
                res.redirect('/common/orgDashboard');
            } else {
                res.redirect('/');
            }
        });
    });

    app.get('/account', isAuthenticated, (req, res) => {
        res.render('account/account', { title: 'Account Management', messages: req.flash() });
    });

    // Route to display the update form
    app.get('/account/update', isAuthenticated, async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
            const orgDetails = result.rows[0];
            res.render('account/update', { title: 'Update Account Information', orgDetails, success_msg: req.flash('success'), error_msg: req.flash('error') });
        } catch (error) {
            console.error('Error fetching organization details:', error);
            req.flash('error', 'Failed to load account information. Please try again.');
            res.redirect('/account');
        }
    });

    // Route to handle the update form submission
    app.post('/account/update', isAuthenticated, async (req, res) => {
        const { firstName, lastName, email, phone, password } = req.body;
        const orgId = req.session.organizationId;

        try {
            let query = 'UPDATE organizations SET first_name = $1, last_name = $2, email = $3, organization_phone = $4';
            let params = [firstName, lastName, email, phone, orgId];

            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                query += ', password = $5 WHERE organization_id = $6';
                params.push(hashedPassword);
            } else {
                query += ' WHERE organization_id = $5';
            }

            await pool.query(query, params);

            // Update session values
            req.session.firstName = firstName;
            req.session.lastName = lastName;

            req.flash('success', 'Account information updated successfully.');
            res.redirect('/account/update');
        } catch (error) {
            console.error('Error updating account:', error);
            req.flash('error', 'Failed to update account information. Please try again.');
            res.redirect('/account/update');
        }
    });

    app.get('/account/personalization', isAuthenticated, async (req, res) => {
        try {
            const { organizationId } = req.session;
    
            const result = await pool.query('SELECT * FROM organizations WHERE organization_id = $1', [organizationId]);
            const orgDetails = result.rows[0];
    
            res.render('account/accountPersonalization', {
                title: 'Account Personalization',
                organizationId,
                orgDetails
            });
        } catch (error) {
            console.error('Error rendering account personalization page:', error);
            req.flash('error', 'Failed to load personalization page.');
            res.redirect('/');
        }
    });
    

    app.post('/account/personalization', upload.single('logo'), isAuthenticated, async (req, res) => {
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

    // API route to get subjects by class ID
    app.get('/api/getSubjectsByClass', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        if (!classId) {
            return res.status(400).json({ message: "Class ID is required" });
        }
        try {
            const result = await pool.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching subjects:', error);
            res.status(500).json({ message: 'Failed to fetch subjects.' });
        }
    });

    // Route for uploading slideshow images
    app.post('/account/uploadSlideshowImages', upload.array('slideshowImages', 10), isAuthenticated, async (req, res) => {
        const images = req.files;
        const imageText = req.body.imageText;
        const orgId = req.session.organizationId;
    
        try {
            for (const image of images) {
                await pool.query(
                    'INSERT INTO organization_images (organization_id, image_url, caption) VALUES ($1, $2, $3)',
                    [orgId, image.path, imageText]
                );
            }
            req.flash('success', 'Images uploaded successfully.');
            res.redirect('/account/personalization');
        } catch (error) {
            console.error('Error uploading images:', error);
            req.flash('error', 'Failed to upload images. Please try again.');
            res.redirect('/account/personalization');
        }
    });

    

// Route for adding text sections
app.post('/account/addTextSection', isAuthenticated, async (req, res) => {
    const { heading, paragraph } = req.body;
    const orgId = req.session.organizationId;

    try {
        await pool.query(
            'INSERT INTO organization_texts (organization_id, heading, paragraph) VALUES ($1, $2, $3)',
            [orgId, heading, paragraph]
        );
        req.flash('success', 'Text section added successfully.');
        res.redirect('/account/personalization');
    } catch (error) {
        console.error('Error adding text section:', error);
        req.flash('error', 'Failed to add text section. Please try again.');
        res.redirect('/account/personalization');
    }
});

app.get('/account/managePublicContent', isAuthenticated, async (req, res) => {
    const { organizationId } = req.session;

    try {
        const imagesResult = await pool.query('SELECT * FROM organization_images WHERE organization_id = $1', [organizationId]);
        const textsResult = await pool.query('SELECT * FROM organization_texts WHERE organization_id = $1', [organizationId]);

        res.render('account/managePublicContent', {
            title: 'Manage Public Content',
            images: imagesResult.rows,
            texts: textsResult.rows
        });
    } catch (error) {
        console.error('Error fetching public content:', error);
        req.flash('error', 'Failed to load public content.');
        res.redirect('/account');
    }
});

app.post('/account/updateImage', isAuthenticated, async (req, res) => {
    const { imageId, caption } = req.body;
    const { organizationId } = req.session;

    try {
        await pool.query('UPDATE organization_images SET caption = $1 WHERE image_id = $2 AND organization_id = $3', [caption, imageId, organizationId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating image:', error);
        res.json({ success: false });
    }
});

app.post('/account/deleteImage', isAuthenticated, async (req, res) => {
    const { imageId } = req.body;
    const { organizationId } = req.session;

    try {
        await pool.query('DELETE FROM organization_images WHERE image_id = $1 AND organization_id = $2', [imageId, organizationId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.json({ success: false });
    }
});

app.post('/account/updateText', isAuthenticated, async (req, res) => {
    const { textId, heading, paragraph } = req.body;
    const { organizationId } = req.session;

    try {
        await pool.query('UPDATE organization_texts SET heading = $1, paragraph = $2 WHERE text_id = $3 AND organization_id = $4', [heading, paragraph, textId, organizationId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating text:', error);
        res.json({ success: false });
    }
});

app.post('/account/deleteText', isAuthenticated, async (req, res) => {
    const { textId } = req.body;
    const { organizationId } = req.session;

    try {
        await pool.query('DELETE FROM organization_texts WHERE text_id = $1 AND organization_id = $2', [textId, organizationId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting text:', error);
        res.json({ success: false });
    }
});


};
