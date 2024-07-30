const nodemailer = require('nodemailer');

const legalController = {
    aboutUs: (req, res) => {
        res.render('legal&Compliance/AboutUs', { title: 'About Us' });
    },
    faq: (req, res) => {
        res.render('legal&Compliance/FAQ', { title: 'FAQ' });
    },
    getHelp: (req, res) => {
        res.render('legal&Compliance/Help', {
            title: 'Help',
            success: req.flash('success'),
            error: req.flash('error')
        });
    },
    postHelp: (req, res) => {
        const { name, organization, phone, email, message } = req.body;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const mailOptions = {
            from: email,
            to: process.env.EMAIL_USER,
            subject: `Contact Form Submission from ${name}`,
            text: `Name: ${name}\nOrganization: ${organization}\nPhone: ${phone}\nEmail: ${email}\n\nMessage:\n${message}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error sending email:", error);
                req.flash('error', 'Something went wrong. Please try again later.');
                res.redirect('/legal/help');
            } else {
                req.flash('success', 'Thank you for contacting OnePlace support! We will get back to you soon.');
                res.redirect('/legal/help');
            }
        });
    },
    privacyPolicy: (req, res) => {
        res.render('legal&Compliance/PrivacyPolicy', { title: 'Privacy Policy' });
    },
    termsOfService: (req, res) => {
        res.render('legal&Compliance/TermsofService', { title: 'Terms of Service' });
    }
};

module.exports = legalController;
