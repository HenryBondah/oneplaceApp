const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const flash = require('connect-flash');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

const pool = new Pool({
    connectionString: process.env.DB_CONNECTION_STRING,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Test the pool connection
pool.query('SELECT NOW()', (err, res) => {

});

app.use(session({
    secret: 'YourSecret',
    resave: false,
    saveUninitialized: false
}));

app.use(flash());

app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// Middleware to check if user is authenticated and fetch organization ID
function fetchOrganizationInfo(req, res, next) {
    if (req.session.userId) {
        pool.query('SELECT u.first_name, o.organization_name FROM users u JOIN organizations o ON u.organization_id = o.organization_id WHERE u.user_id = $1', [req.session.userId], (err, result) => {
            if (err) {
                console.error('Error fetching organization info:', err);
                next(err);
            } else {
                req.session.organizationId = result.rows[0].organization_id;
                req.session.organizationName = result.rows[0].organization_name;
                req.session.firstName = result.rows[0].first_name;
                next();
            }
        });
    } else {
        next();
    }
}

app.use(fetchOrganizationInfo);

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pass the pool object to routes
require('./routes/accountRoute')(app, pool);
require('./routes/adminRoute')(app, pool);
require('./routes/commonRoute')(app, pool);
require('./routes/printRoute')(app, pool);

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
