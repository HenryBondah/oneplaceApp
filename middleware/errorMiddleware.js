const createError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const notFound = (req, res, next) => {
    next(createError(404, 'Page Not Found'));
};

const globalErrorHandler = (err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    // Log only non-404 errors to avoid repeated terminal clutter
    if (status !== 404) {
        console.error(`[Error] ${status}: ${message}`);
    }

    // Render error page based on client preferences
    if (req.accepts('html')) {
        res.status(status).render('partials/messages', {
            title: `${status} Error`,
            message,
            status,
        });
    } else if (req.accepts('json')) {
        res.status(status).json({ status, message });
    } else {
        res.type('txt').send(`${status} - ${message}`);
    }
};

module.exports = {
    notFound,
    globalErrorHandler,
};
