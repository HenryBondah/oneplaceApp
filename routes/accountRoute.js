module.exports = function(app, db) {
    const flash = require('connect-flash');
    const session = require('express-session');
    
    app.use(session({ secret: 'YourSecret', resave: false, saveUninitialized: false }));
    app.use(flash());
    
    app.get('/account/login', (req, res) => {
        res.render('account/login', {
            title: 'Login',
            messages: req.flash('error') // Retrieves error messages from the session
        });
    });
    
    app.post('/account/login', (req, res) => {
        const { username, password } = req.body;
        if (username !== 'expectedUsername' || password !== 'expectedPassword') {
            req.flash('error', 'Invalid username or password.');
            res.redirect('/account/login');
        } else {
            res.redirect('/dashboard');
        }
    });

    // Registration Page Route
    app.get('/account/register', (req, res) => {
        res.render('account/register', { title: 'Register' });
    });

    // Handle Registration Submission
    app.post('/account/register', (req, res) => {
        // Registration logic here
        res.redirect('/account/login'); // Redirect to login after registration
    });

    // Account Update Page Route
    app.get('/account/update', (req, res) => {
        res.render('account/update', { title: 'Update Account' });
    });

    // Handle Account Update Submission
    app.post('/account/update', (req, res) => {
        // Update account logic here
        res.redirect('/account/account'); // Redirect to account details page
    });
    // Route for Account Personalization Page
    app.get('/account/personalization', async (req, res) => {
        try {
            const organizationId = req.session.organizationId; // Assuming this is stored in the session
            const query = 'SELECT * FROM organizations WHERE organization_id = $1';
            const result = await db.query(query, [organizationId]);

            if (result.rows.length > 0) {
                const orgDetails = result.rows[0];
                res.render('account/accountPersonalization', {
                    title: 'Personalize Your Account',
                    orgDetails: orgDetails
                });
            } else {
                res.status(404).send('Organization details not found.');
            }
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send('Internal Server Error');
        }
    });
    

    // Account Details Page Route
    app.get('/account/account', (req, res) => {
        res.render('account/account', { title: 'Account Details' });
    });
};
