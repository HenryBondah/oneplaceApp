module.exports = function(app) {
    // Organization Dashboard Route
    app.get('/common/orgDashboard', (req, res) => {
        res.render('common/orgDashboard', { title: 'Organization Dashboard' });
    });

    // Class Dashboard Route
    app.get('/common/classDashboard', (req, res) => {
        const classInfo = {
            className: "Example Class Name",
            students: [] // This would be populated from a database in a real app
        };
        res.render('common/classDashboard', { title: 'Class Dashboard', classInfo: classInfo });
    });

    // Add Class Route
    app.get('/common/addClass', (req, res) => {
        res.render('common/addClass', { title: 'Add Class' });
    });

    app.post('/common/addClass', (req, res) => {
        // Here, you would handle adding a class to the database
        console.log(req.body); // Log the received class information
        res.redirect('/common/orgDashboard'); // Redirect after processing
    });

    // Add Student Route
    app.get('/common/addStudent', (req, res) => {
        res.render('common/addStudent', { title: 'Add Student' });
    });

    app.post('/common/addStudent', (req, res) => {
        // Here, you would handle adding a student to the database
        console.log(req.body); // Log the received student information
        res.redirect('/common/classDashboard'); // Redirect after processing
    });

    // Management Tools Route
    app.get('/common/management', (req, res) => {
        res.render('common/management', { title: 'Management Tools' });
    });

    // Create Employee Route
    app.get('/common/createEmployee', (req, res) => {
        res.render('common/createEmployee', { title: 'Create Employee' });
    });

    app.post('/common/createEmployee', (req, res) => {
        // Here, you would handle the creation of a new employee in the database
        console.log(req.body); // Log the received employee information
        res.redirect('/common/management'); // Redirect after processing
    });

    // Edit Student Route (Example: you need a student ID passed as a query param or part of the URL)
    app.get('/common/editStudent', (req, res) => {
        const studentId = req.query.id; // Assuming ID is passed as a query parameter
        // Fetch student data based on ID
        res.render('common/editStudent', { title: 'Edit Student', studentId: studentId });
    });

    app.post('/common/editStudent', (req, res) => {
        // Handle updating the student information
        console.log(req.body);
        res.redirect('/common/classDashboard'); // Redirect after processing
    });

    // Delete Student Route
    app.get('/common/deleteStudent', (req, res) => {
        const studentId = req.query.id; // Assuming ID is passed as a query parameter
        // Show delete confirmation page
        res.render('common/deleteStudent', { title: 'Delete Student', studentId: studentId });
    });

    app.post('/common/deleteStudent', (req, res) => {
        // Handle the deletion of the student
        console.log(req.body);
        res.redirect('/common/classDashboard'); // Redirect after processing
    });

    // attendance Route
    app.get('/common/attendance', (req, res) => {
        res.render('common/attendance', { title: 'attendance' });
    });

     // attendance Route
     app.get('/common/attendanceCollection', (req, res) => {
        res.render('common/attendanceCollection', { title: 'attendance Page' });
    });

    app.post('/common/addClass', (req, res) => {
        // Here, you would handle adding a class to the database
        console.log(req.body); // Log the received class information
        res.redirect('/common/orgDashboard'); // Redirect after processing
    });

    // assessment Route
    app.get('/common/assessment', (req, res) => {
        res.render('common/assessment', { title: 'Add Class' });
    });

    app.post('/common/assessment', (req, res) => {
        // Here, you would handle adding a class to the database
        console.log(req.body); // Log the received class information
        res.redirect('/common/assessment'); // Redirect after processing
    });
    
};
