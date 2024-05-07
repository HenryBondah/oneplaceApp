// Import required modules and initialize router
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

module.exports = function(app, db) {
    // Set up file upload directory and configuration
    const uploadDirectory = './uploads';
    if (!fs.existsSync(uploadDirectory)){
        fs.mkdirSync(uploadDirectory, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: function(req, file, cb) {
            cb(null, 'uploads/');
        },
        filename: function(req, file, cb) {
            cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
        }
    });
    const upload = multer({ storage: storage });

    app.post('/common/deleteTerm', async (req, res) => {
        const { term_id } = req.body;
        try {
            await db.query('DELETE FROM terms WHERE term_id = $1', [term_id]);
            res.json({ success: true, message: 'Term deleted successfully.' });
        } catch (error) {
            console.error('Error deleting term:', error);
            res.status(500).json({ success: false, message: 'Failed to delete term.', error: error.message });
        }
    });
    

    app.get('/common/orgDashboard', async (req, res) => {
        try {
            const currentYearResult = await db.query(`
                SELECT * FROM school_years
                ORDER BY year_label DESC
                LIMIT 1
            `);
            const currentYear = currentYearResult.rows[0];
    
            let terms = [];
            if (currentYear) {
                const termsResult = await db.query(`
                    SELECT * FROM terms
                    WHERE year_id = $1
                    ORDER BY start_date ASC
                `, [currentYear.id]);
                terms = termsResult.rows;
            }
    
            const classesResult = await db.query('SELECT * FROM classes ORDER BY class_name ASC');
            const classes = classesResult.rows;
    
            const eventsResult = await db.query('SELECT * FROM school_events ORDER BY event_date DESC');
            const events = eventsResult.rows;
    
            const announcementsResult = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
            const announcements = announcementsResult.rows;
    
            res.render('common/orgDashboard', {
                title: 'Organization Dashboard',
                currentDate: new Date(),
                currentYear: currentYear,
                terms: terms,
                classes: classes,
                events: events,
                announcements: announcements  // Pass announcements data to the view
            });
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            res.status(500).send('Error loading the organization dashboard');
        }
    });
    


    app.get('/common/addStudent', async (req, res) => {
        try {
            const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name ASC');
            res.render('common/addStudent', {
                title: 'Add New Student',
                classes: result.rows
            });
        } catch (err) {
            console.error('Error fetching classes:', err);
            res.status(500).send('Error fetching classes');
        }
    });

    app.post('/common/addStudent', upload.single('studentImage'), async (req, res) => {
        const { firstName, lastName, age, height, hometown, classSelect } = req.body;
        if (!firstName || !lastName) {
            return res.status(400).send('First name and last name are required.');
        }
        let studentImageUrl = req.file ? req.file.path : null;
        try {
            const result = await db.query('INSERT INTO students (first_name, last_name, age, height, hometown, class_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING student_id', 
                [firstName, lastName, age, height, hometown, classSelect, studentImageUrl]);
            res.redirect('/common/studentDetails?studentId=' + result.rows[0].student_id);
        } catch (err) {
            console.error('Error adding student:', err);
            res.status(500).send('Failed to add student');
        }
    });

    app.get('/common/studentDetails', async (req, res) => {
        const studentId = req.query.studentId;
        if (!studentId) {
            console.error('No student ID provided');
            return res.redirect('/common/orgDashboard');
        }
        try {
            const studentQuery = `
                SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.image_url, 
                       subj.subject_name, ar.score
                FROM students s
                LEFT JOIN student_subjects ss ON s.student_id = ss.student_id
                LEFT JOIN subjects subj ON ss.subject_id = subj.subject_id
                LEFT JOIN assessments a ON a.subject_id = subj.subject_id
                LEFT JOIN assessment_results ar ON ar.assessment_id = a.assessment_id AND ar.student_id = s.student_id
                WHERE s.student_id = $1;
            `;
            const guardiansQuery = 'SELECT * FROM guardians WHERE student_id = $1';
            const [studentDetails, guardians] = await Promise.all([
                db.query(studentQuery, [studentId]),
                db.query(guardiansQuery, [studentId])
            ]);
            if (studentDetails.rows.length === 0) {
                console.error('Student not found');
                return res.redirect('/common/orgDashboard');
            }
            res.render('common/studentDetails', {
                title: `${studentDetails.rows[0].first_name} ${studentDetails.rows[0].last_name}'s Details`,
                student: studentDetails.rows[0],
                guardians: guardians.rows,
                subjects: studentDetails.rows  // This will contain all related subject and assessment result information
            });
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Error fetching student details');
        }
    });

    // Additional routes for management, assessments, updating records, and handling attendance
    // app.get('/common/management', async (req, res) => {
    //     try {
    //         const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
    //         res.render('common/management', {
    //             title: 'Management Tools',
    //             classes: result.rows
    //         });
    //     } catch (err) {
    //         console.error('Error fetching classes:', err);
    //         res.status(500).send('Error fetching classes');
    //     }
    // });
    app.get('/common/management', async (req, res) => {
        try {
            // Fetch all school years and their terms
            const schoolYears = await db.query(`
                SELECT sy.*, t.*
                FROM school_years sy
                LEFT JOIN terms t ON t.year_id = sy.id
                ORDER BY sy.year_label DESC, t.start_date ASC;
            `);
    
            // Convert flat rows into nested objects
            let structuredSchoolYears = {};
            schoolYears.rows.forEach(row => {
                if (!structuredSchoolYears[row.id]) {
                    structuredSchoolYears[row.id] = {
                        id: row.id,
                        year_label: row.year_label,
                        terms: []
                    };
                }
                if (row.term_id) { // Ensure there is a term linked to the year
                    structuredSchoolYears[row.id].terms.push({
                        term_id: row.term_id,
                        term_name: row.term_name,
                        start_date: row.start_date,
                        end_date: row.end_date
                    });
                }
            });
    
            res.render('common/management', {
                title: 'Management Tools',
                schoolYears: Object.values(structuredSchoolYears) // Convert object to array
            });
        } catch (error) {
            console.error('Error fetching management data:', error);
            res.status(500).send('Failed to load management data');
        }
    });
    



    // Edit, update, and delete operations for students
    app.get('/common/editStudent', async (req, res) => {
        const studentId = req.query.id;
        if (!studentId) {
            console.error('No student ID provided');
            return res.redirect('/common/management');
        }
        try {
            const classResult = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
            const studentResult = await db.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
            if (studentResult.rows.length > 0) {
                res.render('common/editStudent', {
                    title: 'Edit Student',
                    student: studentResult.rows[0],
                    classes: classResult.rows
                });
            } else {
                return res.redirect('/common/management'); // Redirect if no student is found
            }
        } catch (err) {
            console.error('Error fetching data:', err);
            res.status(500).send('Error fetching data');
        }
    });

    app.post('/common/updateStudent', async (req, res) => {
        const { student_id, firstName, lastName, dateOfBirth, classSelect } = req.body;
        try {
            await db.query('UPDATE students SET first_name = $1, last_name = $2, date_of_birth = $3, class_id = $4 WHERE student_id = $5', 
                [firstName, lastName, dateOfBirth, classSelect, student_id]);
            res.redirect('/common/management'); // Redirect to management dashboard
        } catch (err) {
            console.error('Error updating student:', err);
            res.status(500).send('Error updating student');
        }
    });

    app.get('/common/deleteStudent', async (req, res) => {
        const studentId = req.query.id;
        if (!studentId) {
            return res.redirect('/common/management'); // Redirect if student ID is not provided
        }
        try {
            const result = await db.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
            if (result.rows.length > 0) {
                res.render('common/deleteStudent', {
                    title: 'Confirm Delete Student',
                    student: result.rows[0]
                });
            } else {
                return res.redirect('/common/management'); // Redirect if no student is found
            }
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Error fetching student details');
        }
    });

    // Handling attendance data
    app.get('/common/attendance', async (req, res) => {
        const classId = req.query.classId;
        if (!classId) {
            console.error('No class ID provided');
            return res.status(400).send('No class ID provided');
        }
        try {
            const today = new Date();
            const studentsResult = await db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 ORDER BY first_name, last_name', [classId]);
            const attendanceResult = await db.query(`
                SELECT student_id, date, status
                FROM attendance_records
                WHERE class_id = $1 AND date >= (current_date - interval '6 days')
                ORDER BY date;
            `, [classId]);

            const attendanceMap = {};
            attendanceResult.rows.forEach(record => {
                if (!attendanceMap[record.student_id]) {
                    attendanceMap[record.student_id] = {};
                }
                attendanceMap[record.student_id][record.date.toISOString().split('T')[0]] = record.status;
            });

            res.render('common/attendance', {
                title: `Attendance for ${await getClassName(classId)}`,
                className: await getClassName(classId),
                students: studentsResult.rows,
                dates: pastDates,
                today: today.toISOString().split('T')[0],
                classId: classId,
                attendanceMap: attendanceMap
            });
        } catch (err) {
            console.error('Error fetching attendance data:', err);
            res.status(500).send('Error loading attendance page');
        }
    });

    app.get('/common/attendanceCollection', async (req, res) => {
        const classId = parseInt(req.query.classId, 10);
        if (isNaN(classId)) {
            console.error('Invalid classId provided:', req.query.classId);
            return res.status(400).send("Invalid class ID provided.");
        }
        try {
            const result = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name, 
                       to_char(a.date, 'YYYY-MM-DD') as date, 
                       to_char(a.date, 'HH24:MI') as time, 
                       a.status, c.class_name
                FROM students s
                JOIN attendance_records a ON s.student_id = a.student_id
                JOIN classes c ON c.class_id = s.class_id
                WHERE s.class_id = $1
                ORDER BY a.date, s.first_name, s.last_name;
            `, [classId]);

            const rawAttendanceRecords = result.rows;
            if (result.rows.length > 0) {
                const className = result.rows[0].class_name;
                const dates = [...new Set(rawAttendanceRecords.map(record => record.date + ' ' + record.time))];
                const students = {};

                rawAttendanceRecords.forEach(r => {
                    const key = `${r.student_id}`;
                    if (!students[key]) {
                        students[key] = { name: `${r.first_name} ${r.last_name}`, dates: {} };
                    }
                    students[key].dates[r.date] = { time: r.time, status: r.status };
                });

                res.render('common/attendanceCollection', {
                    title: `Attendance Records for ${className}`,
                    classId: classId,
                    students: Object.values(students),
                    dates
                });
            } else {
                res.render('common/attendanceCollection', {
                    title: 'No Attendance Records Available',
                    classId: classId,
                    students: [],
                    dates: []
                });
            }
        } catch (error) {
            console.error('Error fetching attendance records:', error);
            res.status(500).send('Error loading attendance collection page');
        }
    });

    app.post('/common/saveAttendanceForDate', async (req, res) => {
        const { attendance } = req.body;
        const attendancePromises = attendance.map(({ studentId, date, status }) => {
            const updateQuery = `
                INSERT INTO attendance_records (student_id, class_id, date, status)
                VALUES ($1, $2, to_date($3, 'YYYY-MM-DD'), $4)
                ON CONFLICT (student_id, date)
                DO UPDATE SET status = excluded.status;
            `;
            return db.query(updateQuery, [studentId, req.session.classId, date, status]);
        });

        try {
            await Promise.all(attendancePromises);
            res.json({ success: true, message: `Attendance for ${attendance[0].date} updated successfully.` });
        } catch (error) {
            console.error('Error saving attendance:', error);
            res.status(500).json({ success: false, message: "Failed to update attendance records." });
        }
    });

    // Employee creation and management
    app.get('/common/createEmployee', (req, res) => {
        res.render('common/createEmployee', { title: 'Create Employee' });
    });

    app.post('/common/createEmployee', (req, res) => {
        // Log the received employee information
        console.log(req.body);
        res.redirect('/common/management'); // Redirect after processing
    });

    // Assessment management
    app.get('/common/assessment', async (req, res) => {
        const { classId, subjectId } = req.query;
        if (!classId || !subjectId) {
            return res.status(400).send('Class ID and Subject ID are required for the assessment.');
        }

        try {
            // Fetch the class and subject names
            const className = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);
            const subjectName = await db.query('SELECT subject_name FROM subjects WHERE subject_id = $1', [subjectId]);

            if (className.rows.length === 0 || subjectName.rows.length === 0) {
                return res.status(404).send('Class or Subject not found.');
            }

            // Only fetch students who are assigned to the specified subject
            const students = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name
                FROM students s
                JOIN student_subjects ss ON s.student_id = ss.student_id
                WHERE ss.subject_id = $1 AND s.class_id = $2
                ORDER BY s.first_name, s.last_name`,
                [subjectId, classId]);

            res.render('common/assessment', {
                title: `${subjectName.rows[0].subject_name} Assessment for ${className.rows[0].class_name}`,
                className: className.rows[0].class_name,
                students: students.rows,
                subjectName: subjectName.rows[0].subject_name,
                classId,
                subjectId
            });
        } catch (err) {
            console.error('Error on /common/assessment route:', err);
            res.status(500).send('Error loading assessment data.');
        }
    });

    // Subject addition and assessment creation
    // app.get('/common/addSubject', async (req, res) => {
    //     try {
    //         const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
    //         res.render('common/addSubject', {
    //             title: 'Add Subject',
    //             classes: result.rows  // Pass the list of classes to the EJS template
    //         });
    //     } catch (err) {
    //         console.error('Error fetching classes:', err);
    //         res.status(500).send('Error fetching classes');
    //     }
    // });

    // app.post('/common/addSubject', async (req, res) => {
    //     const { subjectName, classId } = req.body;
    //     try {
    //         await db.query('INSERT INTO subjects (subject_name, class_id, created_by) VALUES ($1, $2, $3)', 
    //             [subjectName, classId, req.session.userId]);
    //         res.redirect('/common/management');
    //     } catch (err) {
    //         console.error('Error adding subject:', err);
    //         res.status(500).send('Error adding subject');
    //     }
    // });

    // Test creation and management of assessments
    app.post('/createTest', async (req, res) => {
        const { testName, testWeight, classId, subjectId } = req.body;
        if (!testName || isNaN(parseFloat(testWeight)) || !classId || !subjectId) {
            return res.status(400).send("Missing or invalid input");
        }

        try {
            const result = await db.query('INSERT INTO assessments (title, weight, class_id, subject_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', 
                [testName, parseFloat(testWeight), classId, subjectId, req.session.userId]);
            if (result.rows.length > 0) {
                res.status(201).json(result.rows[0]);
            } else {
                res.status(500).send("Failed to insert the test into the database.");
            }
        } catch (err) {
            console.error('Failed to create test:', err);
            res.status(500).send("Failed to create test");
        }
    });

    // Fetching and managing assessments
    app.get('/common/getAssessments', async (req, res) => {
        const { classId, subjectId } = req.query;
        try {
            const results = await db.query('SELECT * FROM assessments WHERE class_id = $1 AND subject_id = $2', [classId, subjectId]);
            res.json(results.rows);
        } catch (err) {
            console.error('Error fetching assessments:', err);
            res.status(500).send('Server error');
        }
    });

    app.post('/common/updateAssessment', async (req, res) => {
        const { assessmentId, title, weight } = req.body;
        try {
            const results = await db.query('UPDATE assessments SET title = $1, weight = $2 WHERE assessment_id = $3 RETURNING *', [title, parseFloat(weight), assessmentId]);
            if (results.rows.length > 0) {
                res.json(results.rows[0]);
            } else {
                res.status(404).send('Assessment not found');
            }
        } catch (err) {
            console.error('Error updating assessment:', err);
            res.status(500).send('Server error');
        }
    });

    // Saving and updating scores
    app.post('/common/saveScores', async (req, res) => {
        const { studentId, assessmentId, score } = req.body;
        try {
            const result = await db.query(`
                INSERT INTO assessment_results (student_id, assessment_id, score)
                VALUES ($1, $2, $3)
                ON CONFLICT (student_id, assessment_id)
                DO UPDATE SET score = EXCLUDED.score
                RETURNING *;
            `, [studentId, assessmentId, score]);
            if (result.rows.length) {
                res.json({ success: true, message: "Score updated successfully.", data: result.rows[0] });
            } else {
                res.status(500).send("Failed to save the score.");
            }
        } catch (err) {
            console.error('Error saving score:', err);
            res.status(500).send("Error saving score.");
        }
    });

    // Fetching subjects for a class
    app.get('/common/getSubjectsForClass', async (req, res) => {
        const classId = req.query.classId;
        if (!classId) {
            return res.status(400).send('Class ID is required');
        }
        try {
            const result = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId]);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching subjects:', err);
            res.status(500).send('Error fetching subjects');
        }
    });

    // Class dashboard and school year registration
    app.get('/common/classDashboard', async (req, res) => {
        const classId = req.query.classId;
        if (!classId) {
            res.redirect('/common/orgDashboard');
            return;
        }
        try {
            const classResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);
            if (classResult.rows.length === 0) {
                console.error('Error fetching class details or class not found:', err);
                return res.status(500).send('Error fetching class details or class not found');
            }
            const className = classResult.rows[0].class_name;
            const [studentResult, subjectsResult] = await Promise.all([
                db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 ORDER BY first_name, last_name', [classId]),
                db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1', [classId])
            ]);
            res.render('common/classDashboard', {
                title: 'Class Dashboard - ' + className,
                className: className,
                students: studentResult.rows,
                subjects: subjectsResult.rows,
                classId: classId,
                attendanceLink: `/common/attendanceCollection?classId=${classId}`
            });
        } catch (err) {
            console.error('Error fetching data:', err);
            res.status(500).send('Error loading class dashboard');
        }
    });

  // Separate POST routes for school year, events, and announcements
  app.post('/common/registerSchoolYearYear', async (req, res) => {
    try {
        await db.query('INSERT INTO school_years (year_label) VALUES ($1)', [req.body.schoolYear]);
        res.redirect('/common/management');
    } catch (error) {
        console.error('Failed to register school year:', error);
        res.status(500).send('Error processing your request');
    }
});

app.post('/common/registerSchoolYearEvent', async (req, res) => {
    try {
        await db.query('INSERT INTO school_events (name, event_date, details) VALUES ($1, $2, $3)', [req.body.eventName, req.body.startDate, req.body.eventDetails]);
        res.redirect('/common/management');
    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).send('Error processing your request');
    }
});

app.post('/common/registerSchoolYearAnnouncement', async (req, res) => {
    try {
        await db.query('INSERT INTO announcements (message) VALUES ($1)', [req.body.announcement]);
        res.redirect('/common/management');
    } catch (error) {
        console.error('Error posting announcement:', error);
        res.status(500).send('Error processing your request');
    }
});

    app.get('/common/registerSchoolYear', (req, res) => {
        res.render('common/registerSchoolYear', {
            title: 'Register School Year'
        });
    });

    app.post('/common/registerSchoolYear', async (req, res) => {
        const { schoolYear } = req.body;
        try {
            // Insert school year information
            const yearResult = await db.query('INSERT INTO school_years (year_label) VALUES ($1) RETURNING id', [schoolYear]);
            const yearId = yearResult.rows[0].id;
    
            // Process each term
            for (let i = 1; i <= 4; i++) { // Assumes a maximum of 4 terms
                const termName = req.body[`termName${i}`];
                const startDate = req.body[`startDate${i}`];
                const endDate = req.body[`endDate${i}`];
                if (termName) { // Only insert if a term name is provided
                    await db.query('INSERT INTO terms (year_id, term_name, start_date, end_date) VALUES ($1, $2, $3, $4)', [yearId, termName, startDate || null, endDate || null]);
                }
            }
    
            res.redirect('/common/orgDashboard');
        } catch (error) {
            console.error('Failed to register school year and terms:', error);
            res.status(500).send('Error processing your request');
        }
    });
    

    // Deletion routes for events, announcements, and school years
    app.delete('/common/deleteEvent', async (req, res) => {
        const { eventId } = req.body;
        if (!eventId) {
            return res.status(400).json({ success: false, message: "Event ID is required." });
        }
    
        try {
            const result = await db.query('DELETE FROM school_events WHERE id = $1 RETURNING *', [eventId]);
            if (result.rows.length > 0) {
                res.json({ success: true, message: 'Event deleted successfully.' });
            } else {
                res.status(404).json({ success: false, message: 'No event found with that ID.' });
            }
        } catch (error) {
            console.error('Error deleting event:', error);
            res.status(500).json({ success: false, message: 'Failed to delete event.' });
        }
    });
    
    
    

    app.delete('/common/deleteAnnouncement', async (req, res) => {
        const { announcementId } = req.body;
        try {
            await db.query('DELETE FROM announcements WHERE announcement_id = $1', [announcementId]);
            res.json({ success: true, message: 'Announcement deleted successfully.' });
        } catch (error) {
            console.error('Error deleting announcement:', error);
            res.status(500).json({ success: false, message: 'Failed to delete announcement.' });
        }
    });

    app.delete('/common/deleteSchoolYear', async (req, res) => {
        try {
            await db.query('DELETE FROM school_years WHERE id = $1', [req.body.id]);
            res.json({ success: true, message: 'School year deleted successfully.' });
        } catch (error) {
            console.error('Error deleting school year:', error);
            res.status(500).json({ success: false, message: 'Failed to delete school year.' });
        }
    });

    // Route to manage school years, events, and announcements
    app.get('/common/manageRecords', async (req, res) => {
        try {
            const schoolYearsResult = await db.query('SELECT * FROM school_years ORDER BY year_label DESC');
            const schoolEventsResult = await db.query('SELECT * FROM school_events ORDER BY event_date DESC');
            const announcementsResult = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
    
            const schoolYears = schoolYearsResult.rows;
            const schoolEvents = schoolEventsResult.rows;
            const announcements = announcementsResult.rows;
    
            // Fetch terms for each school year
            const yearsWithTerms = await Promise.all(schoolYears.map(async year => {
                const termsResult = await db.query('SELECT * FROM terms WHERE year_id = $1', [year.id]);
                year.terms = termsResult.rows;
                return year;
            }));
    
            res.render('common/manageRecords', {
                title: 'Manage Records',
                schoolYears: yearsWithTerms,
                events: schoolEvents,
                announcements: announcements  // Make sure announcements are passed here
            });
        } catch (error) {
            console.error('Error loading management data:', error);
            res.status(500).send('Failed to load management data');
        }
    });
    


    app.post('/common/updateSchoolYearAndTerms', async (req, res) => {
        const { yearId, year_label, termIds, termNames, startDates, endDates } = req.body;
    
        try {
            // Update the school year
            await db.query('UPDATE school_years SET year_label = $1 WHERE id = $2', [year_label, yearId]);
    
            // Async/await is used to ensure each term update completes before proceeding
            for (let index = 0; index < termIds.length; index++) {
                await db.query('UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4', [
                    termNames[index], startDates[index], endDates[index], termIds[index]
                ]);
            }
    
            // After all updates, redirect to the management view
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Failed to update school year and terms:', error);
            res.status(500).send('Error processing your request');
        }
    });
    

    app.post('/common/updateEvent', async (req, res) => {
        try {
            await db.query('UPDATE school_events SET name = $1, event_date = $2, details = $3 WHERE id = $4', [req.body.name, req.body.event_date, req.body.details, req.body.id]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating event:', error);
            res.status(500).send('Failed to update event.');
        }
    });

    app.post('/common/updateAnnouncement', async (req, res) => {
        const { announcementId, message } = req.body;
        try {
            await db.query('UPDATE announcements SET message = $1 WHERE announcement_id = $2', [message, announcementId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating announcement:', error);
            res.status(500).send('Failed to update announcement.');
        }
    });





  // Ensure all routes use the `app` object directly for consistency
  app.get('/common/addClassSubject', async (req, res) => {
    try {
        const { rows: classes } = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name ASC');
        res.render('common/addClassSubject', {
            title: 'Add Class and Subject',
            classes
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).send('Error loading the add class form.');
    }
});


app.post('/common/addClassSubject', async (req, res) => {
    const { className } = req.body;
    if (!className) {
        return res.status(400).send('Class name is required.');
    }

    try {
        await db.query('INSERT INTO classes (class_name) VALUES ($1)', [className]);
        res.redirect('/common/addClassSubject'); // Redirect back to form to see the new class in list
    } catch (error) {
        console.error('Error adding class:', error);
        res.status(500).send('Failed to add class.');
    }
});

    app.get('/common/addClassSubject', async (req, res) => {
        try {
            const { rows: classes } = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name ASC');
            res.render('common/addClassSubject', {
                title: 'Add Class and Subject',
                classes
            });
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).send('Error loading the form.');
        }
    });

// GET route for adding a subject
app.get('/common/addSubject', async (req, res) => {
    try {
        const result = await db.query('SELECT class_id, class_name FROM classes ORDER BY class_name');
        res.render('common/addSubject', {
            title: 'Add New Subject',
            classes: result.rows
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).send('Failed to load the form for adding a subject.');
    }
});

// POST route for adding a subject directly linked to a class
app.post('/common/addSubject', async (req, res) => {
    const { subjectName, classId } = req.body;
    if (!subjectName || !classId) {
        return res.status(400).send('Subject name and class ID are required.');
    }

    try {
        const result = await db.query('INSERT INTO subjects (subject_name, class_id, created_by) VALUES ($1, $2, $3) RETURNING *', [subjectName, classId, req.session.userId]);
        if (result.rows.length > 0) {
            res.redirect('/common/addClassSubject');
        } else {
            res.status(500).send("Failed to insert the subject into the database.");
        }
    } catch (error) {
        console.error('Failed to add subject:', error);
        res.status(500).send('Error processing your request.');
    }
});

app.post('/common/updateTerm', async (req, res) => {
    const { term_id, term_name, start_date, end_date } = req.body;
    try {
        await db.query('UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4', [term_name, start_date, end_date, term_id]);
        res.redirect('/common/manageRecords');
    } catch (error) {
        console.error('Failed to update term:', error);
        res.status(500).send('Error updating term');
    }
});

app.delete('/common/deleteTerm', async (req, res) => {
    const { term_id } = req.body;
    try {
        await db.query('DELETE FROM terms WHERE term_id = $1', [term_id]);
        res.json({ success: true, message: 'Term deleted successfully.' });
    } catch (error) {
        console.error('Error deleting term:', error);
        res.status(500).json({ success: false, message: 'Failed to delete term.' });
    }
});


};





// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const {
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
// } = require('../controllers/commonController');

// const router = express.Router();

// // Multer setup for file uploads
// const storage = multer.diskStorage({
//     destination: function(req, file, cb) {
//         cb(null, 'uploads/');
//     },
//     filename: function(req, file, cb) {
//         cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
//     }
// });
// const upload = multer({ storage: storage });

// // Route definitions
// router.get('/orgDashboard', orgDashboard);
// router.get('/addStudent', displayAddStudentForm);
// router.post('/addStudent', upload.single('studentImage'), addStudent);
// router.get('/studentDetails', displayStudentDetails);
// router.get('/management', manageClassesAndStudents);
// router.get('/editStudent', editStudent);
// router.post('/updateStudent', updateStudent);
// router.get('/deleteStudent', deleteStudent);
// router.get('/attendance', displayAndManageAttendance);
// router.get('/attendanceCollection', collectAttendanceDetails);
// router.post('/saveAttendanceForDate', saveAttendanceForDate);
// router.get('/createEmployee', createEmployee);
// router.post('/processCreateEmployee', processCreateEmployee);
// router.get('/assessment', manageAssessments);
// router.post('/createTest', createTest);
// router.get('/getAssessments', getAssessments);
// router.post('/updateAssessment', updateAssessment);
// router.post('/saveScores', saveScores);
// router.get('/getSubjectsForClass', getSubjectsForClass);
// router.get('/classDashboard', displayClassDashboard);
// router.post('/registerSchoolYear', registerSchoolYear);
// router.delete('/deleteEvent', deleteEvent);
// router.delete('/deleteAnnouncement', deleteAnnouncement);
// router.delete('/deleteSchoolYear', deleteSchoolYear);
// router.get('/manageRecords', manageRecords);
// router.post('/updateSchoolYear', updateSchoolYear);
// router.post('/updateEvent', updateEvent);
// router.post('/updateAnnouncement', updateAnnouncement);

// module.exports = router;
