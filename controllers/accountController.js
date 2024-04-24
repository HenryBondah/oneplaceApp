exports.login = (req, res) => {
    res.render('account/login', { title: 'Login' });
};

exports.handleLogin = (req, res) => {
    // Login logic here
    res.redirect('/dashboard');
};

exports.register = (req, res) => {
    res.render('account/register', { title: 'Register' });
};
