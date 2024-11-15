const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
require('dotenv').config();
const passport = require('passport');
const db = require('./config/db');
require('./config/passport')(passport);

const setCurrentTerm = require('./middleware/setCurrentTerm'); // Import middleware

const app = express();
const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

// Middleware to serve static files from the uploads directory
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

// Use setCurrentTerm middleware to make the current term globally available
app.use(async (req, res, next) => {
    req.db = db; // Pass the database to the middleware through the request object
    next();
});
app.use(setCurrentTerm);

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const accountRoute = require('./routes/accountRoute');
const adminRoute = require('./routes/adminRoute')(db);
const commonRoute = require('./routes/commonRoute')(db);
const printRoute = require('./routes/printRoute')(db);
const legalRoute = require('./routes/legalRoute');
const enrollmentRoutes = require('./routes/enrollmentRoutes')(db);

app.use('/account', accountRoute);
app.use('/admin', adminRoute);
app.use('/common', commonRoute);
app.use('/print', printRoute);
app.use('/legal', legalRoute);
app.use('/enrollment', enrollmentRoutes); 

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});