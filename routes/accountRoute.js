module.exports = function(app) {
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
app.get('/account/accountPersonalization', (req, res) => {
  res.render('account/accountPersonalization', {
    title: 'Account Personalization'
  });
});

    // Account Details Page Route
    app.get('/account/account', (req, res) => {
        res.render('account/account', { title: 'Account Details' });
    });
};
