module.exports = function(app) {
    // Admin Dashboard Route
    app.get('/admin/', (req, res) => {
        let applications = []; // Example data
        res.render('admin/dashboard', { title: 'Admin Dashboard', applications: applications });
    });

    // Admin Action Page Route
    app.get('/admin/action-page', (req, res) => {
        let applications = []; // Example data
        res.render('admin/action-page', { title: 'Admin Action Page', applications: applications });
    });

    // Super Admin Dashboard Route
    app.get('/admin/superDashboard', (req, res) => {
        res.render('admin/superDashboard', { title: 'Super Admin Dashboard' });
    });

    app.get('/admin/superSettings', (req, res) => {
        res.render('admin/superSettings', { title: 'Super Admin Settings' });
    });
};
