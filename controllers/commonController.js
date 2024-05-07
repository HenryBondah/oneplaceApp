// const { db } = require('../models/commonModel');

// // Function to render the Organization Dashboard
// async function orgDashboard(req, res) {
//     try {
//         const classes = await db.query('SELECT * FROM classes ORDER BY class_name ASC');
//         const events = await db.query('SELECT * FROM school_events ORDER BY event_date DESC');
//         const announcements = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
//         res.render('common/orgDashboard', {
//             title: 'Organization Dashboard',
//             classes: classes.rows,
//             events: events.rows,
//             announcements: announcements.rows
//         });
//     } catch (error) {
//         console.error('Error fetching dashboard data:', error);
//         res.status(500).send('Error loading the organization dashboard');
//     }
// }

// // Function to display the form to add a new student
// async function displayAddStudentForm(req, res) {
//     try {
//         const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name ASC');
//         res.render('common/addStudent', {
//             title: 'Add New Student',
//             classes: result.rows
//         });
//     } catch (error) {
//         console.error('Error fetching classes:', error);
//         res.status(500).send('Error fetching classes');
//     }
// }

// // Function to handle the submission of the new student form
// async function addStudent(req, res) {
//     const { firstName, lastName, age, height, hometown, classSelect } = req.body;
//     let studentImageUrl = req.file ? req.file.path : null;

//     if (!firstName || !lastName) {
//         return res.status(400).send('First name and last name are required.');
//     }

//     try {
//         const result = await db.query('INSERT INTO students (first_name, last_name, age, height, hometown, class_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING student_id', 
//             [firstName, lastName, age, height, hometown, classSelect, studentImageUrl]);
//         res.redirect('/common/studentDetails?studentId=' + result.rows[0].student_id);
//     } catch (error) {
//         console.error('Error adding student:', error);
//         res.status(500).send('Failed to add student');
//     }
// }

// // Function to display student details
// async function displayStudentDetails(req, res) {
//     const studentId = req.query.studentId;

//     if (!studentId) {
//         console.error('No student ID provided');
//         return res.redirect('/common/orgDashboard');
//     }

//     try {
//         const studentQuery = `
//             SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.image_url,
//                    subj.subject_name, ar.score
//             FROM students s
//             LEFT JOIN student_subjects ss ON s.student_id = ss.student_id
//             LEFT JOIN subjects subj ON ss.subject_id = subj.subject_id
//             LEFT JOIN assessments a ON a.subject_id = subj.subject_id
//             LEFT JOIN assessment_results ar ON ar.assessment_id = a.assessment_id AND ar.student_id = s.student_id
//             WHERE s.student_id = $1;
//         `;
//         const guardiansQuery = 'SELECT * FROM guardians WHERE student_id = $1';
//         const [studentDetails, guardians] = await Promise.all([
//             db.query(studentQuery, [studentId]),
//             db.query(guardiansQuery, [studentId])
//         ]);

//         if (studentDetails.rows.length === 0) {
//             console.error('Student not found');
//             return res.redirect('/common/orgDashboard');
//         }

//         res.render('common/studentDetails', {
//             title: `${studentDetails.rows[0].first_name} ${studentDetails.rows[0].last_name}'s Details`,
//             student: studentDetails.rows[0],
//             guardians: guardians.rows,
//             subjects: studentDetails.rows
//         });
//     } catch (error) {
//         console.error('Error fetching student details:', error);
//         res.status(500).send('Error fetching student details');
//     }
// }

// // Function to manage classes and students
// async function manageClassesAndStudents(req, res) {
//     try {
//         const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
//         res.render('common/management', {
//             title: 'Management Tools',
//             classes: result.rows
//         });
//     } catch (error) {
//         console.error('Error fetching classes:', error);
//         res.status(500).send('Error fetching classes');
//     }
// }

// // Function to edit student details
// async function editStudent(req, res) {
//     const studentId = req.query.id;

//     if (!studentId) {
//         console.error('No student ID provided');
//         return res.redirect('/common/management');
//     }

//     try {
//         const classResult = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
//         const studentResult = await db.query('SELECT * FROM students WHERE student_id = $1', [studentId]);

//         if (studentResult.rows.length > 0) {
//             res.render('common/editStudent', {
//                 title: 'Edit Student',
//                 student: studentResult.rows[0],
//                 classes: classResult.rows
//             });
//         } else {
//             return res.redirect('/common/management'); // Redirect if no student is found
//         }
//     } catch (error) {
//         console.error('Error fetching data:', error);
//         res.status(500).send('Error fetching data');
//     }
// }

// // Function to update student details
// async function updateStudent(req, res) {
//     const { student_id, firstName, lastName, dateOfBirth, classSelect } = req.body;

//     try {
//         await db.query('UPDATE students SET first_name = $1, last_name = $2, date_of_birth = $3, class_id = $4 WHERE student_id = $5',
//             [firstName, lastName, dateOfBirth, classSelect, student_id]);
//         res.redirect('/common/management'); // Redirect to management dashboard
//     } catch (error) {
//         console.error('Error updating student:', error);
//         res.status(500).send('Error updating student');
//     }
// }

// // Function to confirm and delete a student
// async function confirmAndDeleteStudent(req, res) {
//     const studentId = req.query.id;

//     if (!studentId) {
//         return res.redirect('/common/management'); // Redirect if student ID is not provided
//     }

//     try {
//         const result = await db.query('SELECT * FROM students WHERE student_id = $1', [studentId]);

//         if (result.rows.length > 0) {
//             res.render('common/deleteStudent', {
//                 title: 'Confirm Delete Student',
//                 student: result.rows[0]
//             });
//         } else {
//             return res.redirect('/common/management'); // Redirect if no student is found
//         }
//     } catch (error) {
//         console.error('Error fetching student details:', error);
//         res.status(500).send('Error fetching student details');
//     }
// }

// // Function to delete a student from the database
// async function deleteStudent(req, res) {
//     const studentId = req.query.id;

//     if (!studentId) {
//         return res.redirect('/common/management'); // Redirect if student ID is not provided
//     }

//     try {
//         await db.query('DELETE FROM students WHERE student_id = $1', [studentId]);
//         res.redirect('/common/management'); // Redirect to management dashboard
//     } catch (error) {
//         console.error('Error deleting student:', error);
//         res.status(500).send('Error deleting student');
//     }
// }

// // Function to display and manage attendance
// async function displayAndManageAttendance(req, res) {
//     const classId = req.query.classId;

//     if (!classId) {
//         console.error('No class ID provided');
//         return res.status(400).send('No class ID provided');
//     }

//     try {
//         const today = new Date();
//         const studentsResult = await db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 ORDER BY first_name, last_name', [classId]);
//         const attendanceResult = await db.query(`
//             SELECT student_id, date, status
//             FROM attendance_records
//             WHERE class_id = $1 AND date >= (current_date - interval '6 days')
//             ORDER BY date;
//         `, [classId]);

//         const attendanceMap = {};
//         attendanceResult.rows.forEach(record => {
//             if (!attendanceMap[record.student_id]) {
//                 attendanceMap[record.student_id] = {};
//             }
//             attendanceMap[record.student_id][record.date.toISOString().split('T')[0]] = record.status;
//         });

//         res.render('common/attendance', {
//             title: `Attendance for ${await getClassName(classId)}`,
//             className: await getClassName(classId),
//             students: studentsResult.rows,
//             dates: pastDates,
//             today: today.toISOString().split('T')[0],
//             classId: classId,
//             attendanceMap: attendanceMap
//         });
//     } catch (error) {
//         console.error('Error fetching attendance data:', error);
//         res.status(500).send('Error loading attendance page');
//     }
// }

// // Function to collect detailed attendance information
// async function collectAttendanceDetails(req, res) {
//     const classId = parseInt(req.query.classId, 10);

//     if (isNaN(classId)) {
//         console.error('Invalid classId provided:', req.query.classId);
//         return res.status(400).send("Invalid class ID provided.");
//     }

//     try {
//         const result = await db.query(`
//             SELECT s.student_id, s.first_name, s.last_name,
//                    to_char(a.date, 'YYYY-MM-DD') as date,
//                    to_char(a.date, 'HH24:MI') as time,
//                    a.status, c.class_name
//             FROM students s
//             JOIN attendance_records a ON s.student_id = a.student_id
//             JOIN classes c ON c.class_id = s.class_id
//             WHERE s.class_id = $1
//             ORDER BY a.date, s.first_name, s.last_name;
//         `, [classId]);

//         const rawAttendanceRecords = result.rows;

//         if (result.rows.length > 0) {
//             const className = result.rows[0].class_name;
//             const dates = [...new Set(rawAttendanceRecords.map(record => record.date + ' ' + record.time))];
//             const students = {};

//             rawAttendanceRecords.forEach(r => {
//                 const key = `${r.student_id}`;
//                 if (!students[key]) {
//                     students[key] = { name: `${r.first_name} ${r.last_name}`, dates: {} };
//                 }
//                 students[key].dates[r.date] = { time: r.time, status: r.status };
//             });

//             res.render('common/attendanceCollection', {
//                 title: `Attendance Records for ${className}`,
//                 classId: classId,
//                 students: Object.values(students),
//                 dates
//             });
//         } else {
//             res.render('common/attendanceCollection', {
//                 title: 'No Attendance Records Available',
//                 classId: classId,
//                 students: [],
//                 dates: []
//             });
//         }
//     } catch (error) {
//         console.error('Error fetching attendance records:', error);
//         res.status(500).send('Error loading attendance collection page');
//     }
// }

// // Function to save attendance data for a specific date
// async function saveAttendanceForDate(req, res) {
//     const { attendance } = req.body;
//     const attendancePromises = attendance.map(({ studentId, date, status }) => {
//         const updateQuery = `
//             INSERT INTO attendance_records (student_id, class_id, date, status)
//             VALUES ($1, $2, to_date($3, 'YYYY-MM-DD'), $4)
//             ON CONFLICT (student_id, date)
//             DO UPDATE SET status = excluded.status;
//         `;
//         return db.query(updateQuery, [studentId, req.session.classId, date, status]);
//     });

//     try {
//         await Promise.all(attendancePromises);
//         res.json({ success: true, message: `Attendance for ${attendance[0].date} updated successfully.` });
//     } catch (error) {
//         console.error('Error saving attendance:', error);
//         res.status(500).json({ success: false, message: "Failed to update attendance records." });
//     }
// }

// // Function to create a new employee
// function createEmployee(req, res) {
//     res.render('common/createEmployee', { title: 'Create Employee' });
// }

// // Function to process the creation of a new employee
// function processCreateEmployee(req, res) {
//     // Log the received employee information
//     console.log(req.body);
//     res.redirect('/common/management'); // Redirect after processing
// }

// // Function to manage assessments
// async function manageAssessments(req, res) {
//     const { classId, subjectId } = req.query;

//     if (!classId || !subjectId) {
//         return res.status(400).send('Class ID and Subject ID are required for the assessment.');
//     }

//     try {
//         // Fetch the class and subject names
//         const className = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);
//         const subjectName = await db.query('SELECT subject_name FROM subjects WHERE subject_id = $1', [subjectId]);

//         if (className.rows.length === 0 || subjectName.rows.length === 0) {
//             return res.status(404).send('Class or Subject not found.');
//         }

//         // Only fetch students who are assigned to the specified subject
//         const students = await db.query(`
//             SELECT s.student_id, s.first_name, s.last_name
//             FROM students s
//             JOIN student_subjects ss ON s.student_id = ss.student_id
//             WHERE ss.subject_id = $1 AND s.class_id = $2
//             ORDER BY s.first_name, s.last_name`,
//             [subjectId, classId]);

//         res.render('common/assessment', {
//             title: `${subjectName.rows[0].subject_name} Assessment for ${className.rows[0].class_name}`,
//             className: className.rows[0].class_name,
//             students: students.rows,
//             subjectName: subjectName.rows[0].subject_name,
//             classId,
//             subjectId
//         });
//     } catch (error) {
//         console.error('Error on /common/assessment route:', error);
//         res.status(500).send('Error loading assessment data.');
//     }
// }

// // Function to add a subject and link it to a class
// async function addSubject(req, res) {
//     const { subjectName, classId } = req.body;

//     if (!subjectName || !classId) {
//         return res.status(400).send('Subject name and class ID are required.');
//     }

//     try {
//         const result = await db.query('INSERT INTO subjects (subject_name, class_id, created_by) VALUES ($1, $2, $3) RETURNING *', [subjectName, classId, req.session.userId]);

//         if (result.rows.length > 0) {
//             res.redirect('/common/addClassSubject');
//         } else {
//             res.status(500).send("Failed to insert the subject into the database.");
//         }
//     } catch (error) {
//         console.error('Failed to add subject:', error);
//         res.status(500).send('Error processing your request.');
//     }
// }

// // Function to create and manage tests within assessments
// async function createTest(req, res) {
//     const { testName, testWeight, classId, subjectId } = req.body;

//     if (!testName || isNaN(parseFloat(testWeight)) || !classId || !subjectId) {
//         return res.status(400).send("Missing or invalid input");
//     }

//     try {
//         const result = await db.query('INSERT INTO assessments (title, weight, class_id, subject_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
//             [testName, parseFloat(testWeight), classId, subjectId, req.session.userId]);

//         if (result.rows.length > 0) {
//             res.status(201).json(result.rows[0]);
//         } else {
//             res.status(500).send("Failed to insert the test into the database.");
//         }
//     } catch (error) {
//         console.error('Failed to create test:', error);
//         res.status(500).send("Failed to create test");
//     }
// }

// // Function to fetch assessments for a specific class and subject
// async function getAssessments(req, res) {
//     const { classId, subjectId } = req.query;

//     try {
//         const results = await db.query('SELECT * FROM assessments WHERE class_id = $1 AND subject_id = $2', [classId, subjectId]);
//         res.json(results.rows);
//     } catch (error) {
//         console.error('Error fetching assessments:', error);
//         res.status(500).send('Server error');
//     }
// }

// // Function to update an assessment
// async function updateAssessment(req, res) {
//     const { assessmentId, title, weight } = req.body;

//     try {
//         const results = await db.query('UPDATE assessments SET title = $1, weight = $2 WHERE assessment_id = $3 RETURNING *', [title, parseFloat(weight), assessmentId]);

//         if (results.rows.length > 0) {
//             res.json(results.rows[0]);
//         } else {
//             res.status(404).send('Assessment not found');
//         }
//     } catch (error) {
//         console.error('Error updating assessment:', error);
//         res.status(500).send('Server error');
//     }
// }

// // Function to save and update scores for assessments
// async function saveScores(req, res) {
//     const { studentId, assessmentId, score } = req.body;

//     try {
//         const result = await db.query(`
//             INSERT INTO assessment_results (student_id, assessment_id, score)
//             VALUES ($1, $2, $3)
//             ON CONFLICT (student_id, assessment_id)
//             DO UPDATE SET score = EXCLUDED.score
//             RETURNING *;
//         `, [studentId, assessmentId, score]);

//         if (result.rows.length) {
//             res.json({ success: true, message: "Score updated successfully.", data: result.rows[0] });
//         } else {
//             res.status(500).send("Failed to save the score.");
//         }
//     } catch (error) {
//         console.error('Error saving score:', error);
//         res.status(500).send("Error saving score.");
//     }
// }

// // Function to fetch subjects for a specific class
// async function getSubjectsForClass(req, res) {
//     const classId = req.query.classId;

//     if (!classId) {
//         return res.status(400).send('Class ID is required');
//     }

//     try {
//         const result = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId]);
//         res.json(result.rows);
//     } catch (error) {
//         console.error('Error fetching subjects:', error);
//         res.status(500).send('Error fetching subjects');
//     }
// }

// // Function to display the class dashboard with details
// async function displayClassDashboard(req, res) {
//     const classId = req.query.classId;

//     if (!classId) {
//         res.redirect('/common/orgDashboard');
//         return;
//     }

//     try {
//         const classResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);

//         if (classResult.rows.length === 0) {
//             console.error('Error fetching class details or class not found:', error);
//             return res.status(500).send('Error fetching class details or class not found');
//         }

//         const className = classResult.rows[0].class_name;
//         const [studentResult, subjectsResult] = await Promise.all([
//             db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 ORDER BY first_name, last_name', [classId]),
//             db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId])
//         ]);

//         res.render('common/classDashboard', {
//             title: 'Class Dashboard - ' + className,
//             className: className,
//             students: studentResult.rows,
//             subjects: subjectsResult.rows,
//             classId: classId,
//             attendanceLink: `/common/attendanceCollection?classId=${classId}`
//         });
//     } catch (error) {
//         console.error('Error fetching data:', error);
//         res.status(500).send('Error loading class dashboard');
//     }
// }

// // Function to register a school year
// async function registerSchoolYear(req, res) {
//     const { schoolYear, eventName, startDate, eventDetails, announcement } = req.body;

//     try {
//         // Insert or update school year information
//         const yearCheck = await db.query('SELECT * FROM school_years WHERE year_label = $1', [schoolYear]);

//         if (yearCheck.rows.length === 0) {
//             await db.query('INSERT INTO school_years (year_label) VALUES ($1)', [schoolYear]);
//         }

//         // Insert event into database
//         if (eventName) {
//             await db.query('INSERT INTO school_events (name, event_date, details) VALUES ($1, $2, $3)', [eventName, startDate, eventDetails]);
//         }

//         // Insert announcement into database
//         if (announcement) {
//             await db.query('INSERT INTO announcements (message) VALUES ($1)', [announcement]);
//         }

//         res.redirect('/common/orgDashboard');
//     } catch (error) {
//         console.error('Failed to register school year:', error);
//         res.status(500).send('Error processing your request');
//     }
// }

// // Function to delete events, announcements, and school years
// async function deleteEvent(req, res) {
//     const { eventId } = req.body;

//     if (!eventId) {
//         return res.status(400).json({ success: false, message: "Event ID is required." });
//     }

//     try {
//         const result = await db.query('DELETE FROM school_events WHERE id = $1 RETURNING *', [eventId]);

//         if (result.rows.length > 0) {
//             res.json({ success: true, message: 'Event deleted successfully.' });
//         } else {
//             res.status(404).json({ success: false, message: 'No event found with that ID.' });
//         }
//     } catch (error) {
//         console.error('Error deleting event:', error);
//         res.status(500).json({ success: false, message: 'Failed to delete event.' });
//     }
// }

// async function deleteAnnouncement(req, res) {
//     const { announcementId } = req.body;

//     try {
//         await db.query('DELETE FROM announcements WHERE announcement_id = $1', [announcementId]);
//         res.json({ success: true, message: 'Announcement deleted successfully.' });
//     } catch (error) {
//         console.error('Error deleting announcement:', error);
//         res.status(500).json({ success: false, message: 'Failed to delete announcement.' });
//     }
// }

// async function deleteSchoolYear(req, res) {
//     try {
//         await db.query('DELETE FROM school_years WHERE id = $1', [req.body.id]);
//         res.json({ success: true, message: 'School year deleted successfully.' });
//     } catch (error) {
//         console.error('Error deleting school year:', error);
//         res.status(500).json({ success: false, message: 'Failed to delete school year.' });
//     }
// }

// // Function to manage school years, events, and announcements
// async function manageRecords(req, res) {
//     try {
//         // Fetch school years, events from 'school_events', and announcements
//         const schoolYearsResult = await db.query('SELECT * FROM school_years ORDER BY year_label DESC');
//         const eventsResult = await db.query('SELECT * FROM school_events ORDER BY event_date DESC');
//         const announcementsResult = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');

//         res.render('common/manageRecords', {
//             title: 'Manage Records',
//             schoolYears: schoolYearsResult.rows,
//             events: eventsResult.rows,
//             announcements: announcementsResult.rows
//         });
//     } catch (error) {
//         console.error('Error loading management data:', error);
//         res.status(500).send('Failed to load management data');
//     }
// }

// // Function to update records for school years, events, and announcements
// async function updateSchoolYear(req, res) {
//     try {
//         await db.query('UPDATE school_years SET year_label = $1 WHERE id = $2', [req.body.year_label, req.body.id]);
//         res.redirect('/common/manageRecords');
//     } catch (error) {
//         console.error('Error updating school year:', error);
//         res.status(500).send('Failed to update school year.');
//     }
// }

// async function updateEvent(req, res) {
//     try {
//         await db.query('UPDATE school_events SET name = $1, event_date = $2, details = $3 WHERE id = $4', [req.body.name, req.body.event_date, req.body.details, req.body.id]);
//         res.redirect('/common/manageRecords');
//     } catch (error) {
//         console.error('Error updating event:', error);
//         res.status(500).send('Failed to update event.');
//     }
// }

// async function updateAnnouncement(req, res) {
//     const { announcementId, message } = req.body;

//     try {
//         await db.query('UPDATE announcements SET message = $1 WHERE announcement_id = $2', [message, announcementId]);
//         res.redirect('/common/manageRecords');
//     } catch (error) {
//         console.error('Error updating announcement:', error);
//         res.status(500).send('Failed to update announcement.');
//     }
// }

// // Exporting all functions used in the routes
// module.exports = {
//     orgDashboard,
//     displayAddStudentForm,
//     addStudent,
//     displayStudentDetails,
//     manageClassesAndStudents,
//     editStudent,
//     updateStudent,
//     deleteStudent,
//     displayAndManageAttendance,
//     collectAttendanceDetails,
//     saveAttendanceForDate,
//     createEmployee,
//     processCreateEmployee,
//     manageAssessments,
//     createTest,
//     getAssessments,
//     updateAssessment,
//     saveScores,
//     getSubjectsForClass,
//     displayClassDashboard,
//     registerSchoolYear,
//     deleteEvent,
//     deleteAnnouncement,
//     deleteSchoolYear,
//     manageRecords,
//     updateSchoolYear,
//     updateEvent,
//     updateAnnouncement
// };

