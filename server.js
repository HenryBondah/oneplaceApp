const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
require('dotenv').config();
const passport = require('passport');
const db = require('./config/db');
require('./config/passport')(passport);

const app = express();
const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
    secret: 'YourSecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 6000000 } 
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const accountRoute = require('./routes/accountRoute');
const adminRoute = require('./routes/adminRoute')(db);
const commonRoute = require('./routes/commonRoute')(db);
const printRoute = require('./routes/printRoute')(db);

app.use('/account', accountRoute);
app.use('/admin', adminRoute);
app.use('/common', commonRoute);
app.use('/print', printRoute);

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
