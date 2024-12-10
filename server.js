const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
require('dotenv').config();
const passport = require('passport');
const db = require('./config/db');
require('./config/passport')(passport);

const setCurrentTerm = require('./middleware/setCurrentTerm'); // Middleware to set the current term
const { notFound, globalErrorHandler } = require('./middleware/errorMiddleware'); // Error handling middleware

const app = express();
const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

// Middleware to serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'YourSecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 6000000 }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Flash messages middleware
app.use(flash());

// Pass session and flash messages to all views
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.messages = {
        success: req.flash('success'),
        error: req.flash('error'),
    };
    next();
});

// Set current term middleware
app.use(async (req, res, next) => {
    req.db = db; // Attach the database instance to the request object
    next();
});
app.use(setCurrentTerm);

// Template engine setup
app.use(expressLayouts);
app.set('view engine', 'ejs');

// Static files and parsing middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const accountRoute = require('./routes/accountRoute');
const adminRoute = require('./routes/adminRoute')(db);
const commonRoute = require('./routes/commonRoute')(db);
const printRoute = require('./routes/printRoute')(db);
const legalRoute = require('./routes/legalRoute');
const enrollmentRoutes = require('./routes/enrollmentRoutes')(db);

// Use routes
app.use('/account', accountRoute);
app.use('/admin', adminRoute);
app.use('/common', commonRoute);
app.use('/print', printRoute);
app.use('/legal', legalRoute);
app.use('/enrollment', enrollmentRoutes);

// Home route
app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

// Test error simulation routes (optional for debugging)
const errorTestRoute = require('./routes/errorTestRoute');
app.use('/test-errors', errorTestRoute);

// Handle 404 errors
app.use(notFound);

// Global error handler for other errors
app.use(globalErrorHandler);

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
