const bcrypt = require('bcrypt');
const db = require('../config/db');
const path = require('path');
const nodemailer = require('nodemailer'); 

async function sendRegistrationSuccessEmail(email, firstName, lastName, password) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NOTIFY_EMAIL_USER,
            pass: process.env.NOTIFY_EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: email,
        subject: 'Account Registration Confirmation',
        text: `Hello ${firstName} ${lastName},\n\nYour account has been created successfully. You can now log in using the following credentials:\n\nEmail: ${email}\nPassword: ${password}\n\nYou can change your password at any time in the account settings.\n\nBest regards,\nONEPLACE Team`
    };

    await transporter.sendMail(mailOptions);
}

async function sendRegistrationFailureEmail(email, reason) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NOTIFY_EMAIL_USER,
            pass: process.env.NOTIFY_EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: email,
        subject: 'Account Registration Failed',
        text: `Hello,\n\nYour account registration attempt failed due to the following reason: ${reason}\n\nPlease try again or contact support for assistance.\n\nBest regards,\nONEPLACE Team`
    };

    await transporter.sendMail(mailOptions);
}

async function notifyAdminOfRegistration(firstName, lastName, orgName, email, orgPhone) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NOTIFY_EMAIL_USER,
            pass: process.env.NOTIFY_EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: 'New Account Registration',
        text: `A new account has been registered:\n\nName: ${firstName} ${lastName}\nOrganization: ${orgName}\nEmail: ${email}\nPhone: ${orgPhone}\n\nPlease review the registration details.`
    };

    await transporter.sendMail(mailOptions);
}

const accountController = {
    registerGet: (req, res) => {
        res.render('account/register', { title: 'Register', messages: req.flash() });
    },

    registerPost: async (req, res) => {
        const { firstName, lastName, email, password, orgName, orgAddress, orgPhone } = req.body;
        const proof1 = req.files['proof1'] ? req.files['proof1'][0].path : '';
        const proof2 = req.files['proof2'] ? req.files['proof2'][0].path : '';

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Check for existing email, organization name, phone, and address
            const existingOrg = await client.query(
                'SELECT * FROM organizations WHERE email = $1 OR organization_name = $2 OR organization_phone = $3 OR organization_address = $4',
                [email, orgName, orgPhone, orgAddress]
            );

            if (existingOrg.rows.length > 0) {
                const existingOrgData = existingOrg.rows[0];
                let message = '';

                if (existingOrgData.on_hold) {
                    message = 'An account with these details is currently on hold. Please contact support to resume your account.';
                } else if (existingOrgData.deleted) {
                    message = 'An account with these details has been deleted. Please contact support to restore your account.';
                } else {
                    message = 'An account with these details already exists.';
                }

                req.flash('error', message);
                await sendRegistrationFailureEmail(email, message);
                res.redirect('/account/register');
                return;
            }

            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Insert new organization record
            const result = await client.query(
                'INSERT INTO organizations (organization_name, organization_address, organization_phone, proof_of_existence_1, proof_of_existence_2, email, password, first_name, last_name, approved, on_hold, deleted) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, false) RETURNING organization_id',
                [orgName, orgAddress, orgPhone, proof1, proof2, email, hashedPassword, firstName, lastName]
            );

            const orgId = result.rows[0].organization_id;

            await client.query('COMMIT');

            // Send notification emails
            await sendRegistrationSuccessEmail(email, firstName, lastName, password);
            await notifyAdminOfRegistration(firstName, lastName, orgName, email, orgPhone);

            req.flash('success', 'Registration successful. You can now log in.');
            res.redirect('/account/login');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error during registration:', error.message);
            req.flash('error', 'Registration failed. Please try again.');
            await sendRegistrationFailureEmail(email, error.message);
            res.redirect('/account/register');
        } finally {
            client.release();
        }
    },
    
    

    loginGet: (req, res) => {
        res.render('account/login', { title: 'Login', messages: req.flash() });
    },

    loginPost: async (req, res) => {
        const { email, password } = req.body;
        try {
            const userResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                const match = await bcrypt.compare(password, user.password);
                if (match) {
                    const orgResult = await db.query('SELECT * FROM organizations WHERE organization_id = $1', [user.organization_id]);
                    if (orgResult.rows.length > 0) {
                        const organization = orgResult.rows[0];

                        if (organization.deleted) {
                            req.flash('error', 'Your organization account has been deleted. Please contact support for assistance.');
                            res.redirect('/account/login');
                            return;
                        }

                        if (organization.on_hold) {
                            req.flash('error', 'Your organization account is currently on hold. Please contact support for further information.');
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
                            req.session.logo = organization.logo; // Store logo in session
                            req.session.fontStyle = organization.font_style; // Store font style in session

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

            const orgResult = await db.query('SELECT * FROM organizations WHERE email = $1', [email]);
            if (orgResult.rows.length > 0) {
                const organization = orgResult.rows[0];
                const match = await bcrypt.compare(password, organization.password);
                if (match) {
                    if (organization.deleted) {
                        req.flash('error', 'Your organization account has been deleted. Please contact support for assistance.');
                        res.redirect('/account/login');
                        return;
                    }

                    if (organization.on_hold) {
                        req.flash('error', 'Your organization account is currently on hold. Please contact support for further information.');
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
                        req.session.logo = organization.logo; // Store logo in session
                        req.session.fontStyle = organization.font_style; // Store font style in session

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
    },

    logoutGet: (req, res) => {
        req.session.destroy(err => {
            if (err) {
                console.error('Error logging out:', err);
                req.flash('error', 'Failed to log out. Please try again.');
                res.redirect('/common/orgDashboard');
            } else {
                res.redirect('/');
            }
        });
    },

    accountGet: (req, res) => {
        res.render('account/account', { title: 'Account Management', messages: req.flash() });
    },

    updateGet: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM organizations WHERE organization_id = $1', [req.session.organizationId]);
            const orgDetails = result.rows[0];
            res.render('account/update', { title: 'Update Account Information', orgDetails, success_msg: req.flash('success'), error_msg: req.flash('error') });
        } catch (error) {
            console.error('Error fetching organization details:', error);
            req.flash('error', 'Failed to load account information. Please try again.');
            res.redirect('/account');
        }
    },

    updatePost: async (req, res) => {
        const { firstName, lastName, email, phone, password, confirmPassword } = req.body;
        const orgId = req.session.organizationId;
    
        // Check for password match and optional update
        if (password && password !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect('/account/update');
        }
    
        try {
            let query = 'UPDATE organizations SET first_name = $1, last_name = $2, email = $3, organization_phone = $4';
            let params = [firstName, lastName, email, phone];
    
            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                query += ', password = $5 WHERE organization_id = $6';
                params.push(hashedPassword, orgId);
            } else {
                query += ' WHERE organization_id = $5';
                params.push(orgId);
            }
    
            const result = await db.query(query, params);
    
            // Update session values
            req.session.firstName = firstName;
            req.session.lastName = lastName;
            req.session.save();
    
            req.flash('success', 'Account information updated successfully.');
            res.redirect('/account/update');
        } catch (error) {
            console.error('Error updating account:', error);
            req.flash('error', 'Failed to update account information. Please try again.');
            res.redirect('/account/update');
        }
    },
    
    personalizationGet: async (req, res) => {
        try {
            const { organizationId } = req.session;

            const result = await db.query('SELECT * FROM organizations WHERE organization_id = $1', [organizationId]);
            const orgDetails = result.rows[0];

            const heroImageResult = await db.query('SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2', [organizationId, 'hero']);
            const heroImage = heroImageResult.rows[0];

            const slideshowImagesResult = await db.query('SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2', [organizationId, 'slideshow']);
            const slideshowImages = slideshowImagesResult.rows;

            res.render('account/accountPersonalization', {
                title: 'Account Personalization',
                organizationId,
                orgDetails,
                heroImage,
                slideshowImages,
                success_msg: req.flash('success'),
                error_msg: req.flash('error')
            });
        } catch (error) {
            console.error('Error rendering account personalization page:', error);
            req.flash('error', 'Failed to load personalization page.');
            res.redirect('/');
        }
    },

    personalizationPost: async (req, res) => {
        try {
            const { orgName, font } = req.body;

            const updateQuery = `
                UPDATE organizations
                SET organization_name = $1, font_style = $2
                WHERE organization_id = $3
            `;

            await db.query(updateQuery, [orgName, font, req.session.organizationId]);

            req.session.organizationName = orgName;
            req.session.fontStyle = font;

            req.flash('success', 'Personalization updated successfully.');
            res.redirect('/account/personalization');
        } catch (err) {
            console.error('Error updating personalization:', err);
            req.flash('error', 'An error occurred while updating personalization. Please try again.');
            res.redirect('/account/personalization');
        }
    },

    personalizationLogoPost: async (req, res) => {
        try {
            let logoPath = null;

            if (req.file) {
                // Save the logo file
                logoPath = path.join('uploads', req.file.filename); // Use path.join to create the correct file path

                const updateQuery = `
                    UPDATE organizations
                    SET logo = $1
                    WHERE organization_id = $2
                `;

                await db.query(updateQuery, [logoPath, req.session.organizationId]);

                req.session.logo = logoPath;
                req.flash('success', 'Logo updated successfully.');
            } else {
                req.flash('error', 'No file uploaded. Please select a file to upload.');
            }

            res.redirect('/account/personalization');
        } catch (err) {
            console.error('Error updating logo:', err);
            req.flash('error', 'An error occurred while updating logo. Please try again.');
            res.redirect('/account/personalization');
        }
    },

    getSubjectsByClass: async (req, res) => {
        const { classId } = req.query;
        if (!classId) {
            return res.status(400).json({ message: "Class ID is required" });
        }
        try {
            const result = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching subjects:', error);
            res.status(500).json({ message: 'Failed to fetch subjects.' });
        }
    },

    uploadSlideshowImages: async (req, res) => {
        const images = req.files;
        const imageText = req.body.imageText;
        const imageAllocation = req.body.imageAllocation;
        const orgId = req.session.organizationId;

        try {
            for (const image of images) {
                await db.query(
                    'INSERT INTO organization_images (organization_id, image_url, caption, allocation) VALUES ($1, $2, $3, $4)',
                    [orgId, image.path, imageText, imageAllocation]
                );
            }
            req.flash('success', 'Images uploaded successfully.');
            res.redirect('/account/personalization');
        } catch (error) {
            console.error('Error uploading images:', error);
            req.flash('error', 'Failed to upload images. Please try again.');
            res.redirect('/account/personalization');
        }
    },

    addTextSection: async (req, res) => {
        const { heading, paragraph } = req.body;
        const orgId = req.session.organizationId;

        try {
            await db.query(
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
    },

    managePublicContentGet: async (req, res) => {
        const { organizationId } = req.session;

        try {
            const imagesResult = await db.query('SELECT * FROM organization_images WHERE organization_id = $1', [organizationId]);
            const textsResult = await db.query('SELECT * FROM organization_texts WHERE organization_id = $1', [organizationId]);

            res.render('account/managePublicContent', {
                title: 'Manage Public Content',
                images: imagesResult.rows,
                texts: textsResult.rows,
                success_msg: req.flash('success'),
                error_msg: req.flash('error')
            });
        } catch (error) {
            console.error('Error fetching public content:', error);
            req.flash('error', 'Failed to load public content.');
            res.redirect('/account');
        }
    },

    updateImagePost: async (req, res) => {
        const { imageId, caption, allocation } = req.body;
        const { organizationId } = req.session;

        try {
            await db.query('UPDATE organization_images SET caption = $1, allocation = $2 WHERE image_id = $3 AND organization_id = $4', [caption, allocation, imageId, organizationId]);
            req.flash('success', 'Image updated successfully.');
            res.redirect('/account/managePublicContent');
        } catch (error) {
            console.error('Error updating image:', error);
            req.flash('error', 'Failed to update image. Please try again.');
            res.redirect('/account/managePublicContent');
        }
    },

    deleteImageGet: async (req, res) => {
        const { imageId } = req.params;
        const { organizationId } = req.session;

        try {
            await db.query('DELETE FROM organization_images WHERE image_id = $1 AND organization_id = $2', [imageId, organizationId]);
            req.flash('success', 'Image deleted successfully.');
            res.redirect('/account/managePublicContent');
        } catch (error) {
            console.error('Error deleting image:', error);
            req.flash('error', 'Failed to delete image. Please try again.');
            res.redirect('/account/managePublicContent');
        }
    },

    updateTextPost: async (req, res) => {
        const { textId, heading, paragraph } = req.body;
        const { organizationId } = req.session;

        try {
            await db.query('UPDATE organization_texts SET heading = $1, paragraph = $2 WHERE text_id = $3 AND organization_id = $4', [heading, paragraph, textId, organizationId]);
            req.flash('success', 'Text updated successfully.');
            res.redirect('/account/managePublicContent');
        } catch (error) {
            console.error('Error updating text:', error);
            req.flash('error', 'Failed to update text. Please try again.');
            res.redirect('/account/managePublicContent');
        }
    },

    deleteTextGet: async (req, res) => {
        const { textId } = req.params;
        const { organizationId } = req.session;

        try {
            await db.query('DELETE FROM organization_texts WHERE text_id = $1 AND organization_id = $2', [textId, organizationId]);
            req.flash('success', 'Text deleted successfully.');
            res.redirect('/account/managePublicContent');
        } catch (error) {
            console.error('Error deleting text:', error);
            req.flash('error', 'Failed to delete text. Please try again.');
            res.redirect('/account/managePublicContent');
        }
    }
};

module.exports = accountController;
