const fs = require('fs');
const path = require('path');

const logStream = fs.createWriteStream(path.join(__dirname, 'server.log'), { flags: 'a' });

const requestLogger = (req, res, next) => {
    logStream.write(`[${new Date().toISOString()}] ${req.method} ${req.url}\n`);
    next();
};

const errorLogger = (err, req, res, next) => {
    logStream.write(`[${new Date().toISOString()}] ERROR: ${err.message}\n`);
    next(err);
};

module.exports = {
    requestLogger,
    errorLogger
};
