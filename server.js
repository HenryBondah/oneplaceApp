// const express = require('express');
// const app = express();
// const PORT = process.env.PORT || 4000;
// const expressLayouts = require('express-ejs-layouts');
// app.use(expressLayouts);

// app.set('view engine', 'ejs');

// // Route for Home Page
// app.get('/', (req, res) => {
//   res.render('index', { title: 'Home' });
// });

// // Route for Login Page
// app.get('/account/login', (req, res) => {
//   res.render('account/login', {
//     title: 'Login',
//     messages: { error: null }
//   });
// });

// // Route for Account Registration Page
// app.get('/account/register', (req, res) => {
//   res.render('account/register', {
//     title: 'Register',
//     messages: { error: null }
//   });
// });

// // Route for Admin Dashboard
// app.get('/admin/', (req, res) => {
//   let applications = [];
//   res.render('admin/dashboard', {
//     title: 'Admin Dashboard',
//     applications: applications
//   });
// });

// // Route for Admin Action Page
// app.get('/admin/action-page', (req, res) => {
//   let applications = [];
//   res.render('admin/action-page', {
//     title: 'Admin Action Page',
//     applications: applications
//   });
// });

// // Route for Organization Dashboard
// app.get('/common/orgDashboard', (req, res) => {
//   res.render('common/orgDashboard', {
//     title: 'Organization Dashboard',
//     messages: { error: null }
//   });
// });

// // Route for Class Dashboard
// app.get('/common/classDashboard', (req, res) => {
//   const classInfo = {
//     className: "Dynamic Class Name",
//     students: []
//   };
//   res.render('common/classDashboard', {
//     title: 'Class Dashboard',
//     classInfo: classInfo
//   });
// });

// // Route for Account Tools Page
// app.get('/account/account', (req, res) => {
//   res.render('account/account', {
//     title: 'Account Tools'
//   });
// });

// // Route for Super Admin Dashboard
// app.get('/admin/superAdmin', (req, res) => {
//   res.render('admin/superAdmin', {
//     title: 'Super Admin Dashboard'
//   });
// });

// // Route for Management Tools Page
// app.get('/common/management', (req, res) => {
//   res.render('common/management', {
//     title: 'Management Tools'
//   });
// });

// // Route for Attendance Page
// app.get('/common/attendance', (req, res) => {
//   res.render('common/attendance', {
//     title: 'Attendance'
//   });
// });

// // Route for Assessment Page
// app.get('/common/assessment', (req, res) => {
//   res.render('common/assessment', {
//     title: 'Assessment'
//   });
// });

// // Route for Account Personalization Page
// app.get('/account/accountPersonalization', (req, res) => {
//   res.render('account/accountPersonalization', {
//     title: 'Account Personalization'
//   });
// });

// // Route for Account Update Page
// app.get('/account/update', (req, res) => {
//   res.render('account/update', {
//     title: 'Update Account'
//   });
// });

// // Route for Adding a Class
// app.get('/common/addClass', (req, res) => {
//   res.render('common/addClass', {
//     title: 'Add Class'
//   });
// });

// // Route for Adding a Student
// app.get('/common/addStudent', (req, res) => {
//   res.render('common/addStudent', {
//     title: 'Add Student'
//   });
// });

// // Route for Editing a Student
// app.get('/common/editStudent', (req, res) => {
//   res.render('common/editStudent', {
//     title: 'Edit Student'
//   });
// });

// // Route for Deleting a Student
// app.get('/common/deleteStudent', (req, res) => {
//   res.render('common/deleteStudent', {
//     title: 'Delete Student'
//   });
// });

// // Route for Creating an Employee
// app.get('/common/createEmployee', (req, res) => {
//   res.render('common/createEmployee', {
//     title: 'Create Employee'
//   });
// });

// // Handle Login Form Submission
// app.post('/account/login', (req, res) => {
//   // Authentication logic here
//   res.redirect('/dashboard'); // Redirect to a dashboard or appropriate page after login
// });

// // Handle Account Creation Form Submission
// app.post('/account/register', (req, res) => {
//   // Account creation logic here
//   res.redirect('/account/login'); // Redirect to login page after account creation
// });

// // Middleware for parsing JSON and URL-encoded data
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(express.static('public'));

// // Start the server
// app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// server.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4000;
const expressLayouts = require('express-ejs-layouts');

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

require('./routes/accountRoute')(app);
require('./routes/adminRoute')(app);
require('./routes/commonRoute')(app);
require('./routes/printRoute')(app); // Ensure this line is correct and the file path is accurate

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});
app.get('/print/printStudent', (req, res) => {
  try {
      const studentData = fetchStudentData(); // Example function to fetch data
      res.render('print/printStudent', {
          student: studentData,
          title: 'Print Student'
      });
  } catch (error) {
      console.error('Failed to fetch student data:', error);
      res.status(500).send("Failed to load student data.");
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
