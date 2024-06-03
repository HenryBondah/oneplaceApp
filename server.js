const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

const pool = new Pool({
    connectionString: process.env.DB_CONNECTION_STRING,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pass the pool object to routes
require('./routes/accountRoute')(app, pool);
require('./routes/adminRoute')(app, pool);
require('./routes/commonRoute')(app, pool); // Ensure pool is passed here
require('./routes/printRoute')(app, pool);

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
