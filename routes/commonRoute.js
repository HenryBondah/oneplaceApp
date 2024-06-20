const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function(app, db, pool) {
    const uploadDirectory = './uploads';
    if (!fs.existsSync(uploadDirectory)) {
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

    // Middleware to check if user is authenticated
    function isAuthenticated(req, res, next) {
        if (req.session.organizationId || req.session.userId) {
            return next();
        } else {
            res.redirect('/account/login');
        }
    }

    // Ensure this function is defined to fetch class names
    async function getClassName(pool, classId) {
        const result = await pool.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);
        return result.rows.length > 0 ? result.rows[0].class_name : 'Unknown Class';
    }

    function generateDates(startDate, endDate) {
        const dates = [];
        const currentDate = new Date(startDate);
        const stopDate = new Date(endDate);

        while (currentDate <= stopDate) {
            dates.push(new Date(currentDate).toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return dates;
    }

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


 // Organization Dashboard
 app.get('/common/orgDashboard', isAuthenticated, async (req, res) => {
    try {
        const { organizationId } = req.session;

        // Fetch the current school year and its terms
        const schoolYearResult = await db.query(`
            SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
            FROM school_years sy
            LEFT JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE
            ORDER BY t.start_date
        `, [organizationId]);

        let schoolYear = null;
        if (schoolYearResult.rows.length > 0) {
            schoolYear = {
                id: schoolYearResult.rows[0].school_year_id,
                year_label: schoolYearResult.rows[0].year_label,
                terms: schoolYearResult.rows.map(row => ({
                    term_id: row.term_id,
                    term_name: row.term_name,
                    start_date: row.start_date,
                    end_date: row.end_date,
                    current: row.current
                }))
            };
        }

        // Fetch classes
        const classesResult = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name', [organizationId]);
        const classes = classesResult.rows;

        // Fetch events
        const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date', [organizationId]);
        const events = eventsResult.rows;

        // Fetch announcements
        const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 ORDER BY announcement_id DESC', [organizationId]);
        const announcements = announcementsResult.rows;

        // Fetch current term and its classes
        const currentTermResult = await db.query(`
            SELECT t.term_id, t.term_name, t.start_date, t.end_date, c.class_id, c.class_name
            FROM terms t
            LEFT JOIN term_classes tc ON t.term_id = tc.term_id
            LEFT JOIN classes c ON tc.class_id = c.class_id
            WHERE t.school_year_id = $1 AND t.current = TRUE
        `, [schoolYear?.id]);

        let currentTerm = null;
        if (currentTermResult.rows.length > 0) {
            const firstRow = currentTermResult.rows[0];
            currentTerm = {
                term_id: firstRow.term_id,
                term_name: firstRow.term_name,
                start_date: firstRow.start_date,
                end_date: firstRow.end_date,
                classes: currentTermResult.rows.map(row => ({
                    class_id: row.class_id,
                    class_name: row.class_name
                }))
            };
        }

        res.render('common/orgDashboard', {
            title: 'Organization Dashboard',
            schoolYear,
            currentTerm,
            classes,
            events,
            announcements,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        req.flash('error', 'Failed to load dashboard data.');
        res.redirect('/');
    }
});



app.get('/common/addStudent', isAuthenticated, async (req, res) => {
    try {
        const query = `
            SELECT c.class_id, c.class_name, g.name AS graduation_year_group_name
            FROM classes c
            LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
            WHERE c.organization_id = $1
            ORDER BY c.class_name ASC;
        `;
        const result = await db.query(query, [req.session.organizationId]);
        res.render('common/addStudent', {
            title: 'Add New Student',
            classes: result.rows,
            messages: req.flash() // Ensure messages are passed here
        });
    } catch (err) {
        console.error('Error fetching classes:', err);
        res.status(500).send('Error fetching classes');
    }
});


    app.post('/common/addStudent', upload.single('studentImage'), isAuthenticated, async (req, res) => {
        const { firstName, lastName, dateOfBirth, height, hometown, classId, subjects, guardian1FirstName, guardian1LastName, guardian1Address, guardian1Phone, guardian1Hometown, guardian2FirstName, guardian2LastName, guardian2Address, guardian2Phone, guardian2Hometown, guardian3FirstName, guardian3LastName, guardian3Address, guardian3Phone, guardian3Hometown } = req.body;
    
        if (!firstName || !lastName || !classId || !dateOfBirth) {
            req.flash('error', 'First name, last name, class, and date of birth are required.');
            return res.redirect('/common/addStudent');
        }
    
        let studentImageUrl = req.file ? req.file.path : null;
    
        try {
            const result = await db.query(
                'INSERT INTO students (first_name, last_name, date_of_birth, height, hometown, class_id, image_url, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING student_id',
                [firstName, lastName, dateOfBirth, height, hometown, classId, studentImageUrl, req.session.userId]
            );
            const studentId = result.rows[0].student_id;
    
            const guardians = [
                { firstName: guardian1FirstName, lastName: guardian1LastName, address: guardian1Address, phone: guardian1Phone, hometown: guardian1Hometown },
                { firstName: guardian2FirstName, lastName: guardian2LastName, address: guardian2Address, phone: guardian2Phone, hometown: guardian2Hometown },
                { firstName: guardian3FirstName, lastName: guardian3LastName, address: guardian3Address, phone: guardian3Phone, hometown: guardian3Hometown }
            ];
    
            for (const guardian of guardians) {
                if (guardian.firstName && guardian.lastName) {
                    await db.query(
                        'INSERT INTO guardians (first_name, last_name, address, phone, hometown, student_id) VALUES ($1, $2, $3, $4, $5, $6)',
                        [guardian.firstName, guardian.lastName, guardian.address, guardian.phone, guardian.hometown, studentId]
                    );
                }
            }
    
            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query(
                        'INSERT INTO student_subjects (student_id, subject_id) VALUES ($1, $2)',
                        [studentId, subjectId]
                    );
                }
            }
    
            req.flash('success', 'Student added successfully.');
            res.redirect('/common/addStudent');
        } catch (err) {
            console.error('Error adding student:', err);
            req.flash('error', 'Failed to add student.');
            res.redirect('/common/addStudent');
        }
    });
    
    app.get('/common/studentDetails', isAuthenticated, async (req, res) => {
        const studentId = req.query.studentId;

        if (!studentId) {
            return res.status(400).send('Student ID is required.');
        }

        try {
            const studentResult = await db.query(`
                SELECT s.*, c.class_name, g.name AS grad_year_group_name
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE s.student_id = $1 AND c.organization_id = $2
            `, [studentId, req.session.organizationId]);

            if (studentResult.rows.length === 0) {
                return res.status(404).send('Student not found.');
            }

            const student = studentResult.rows[0];

            const guardiansResult = await db.query(`
                SELECT * FROM guardians
                WHERE student_id = $1
            `, [studentId]);

            const guardians = guardiansResult.rows;

            const subjectsResult = await db.query(`
                SELECT ss.subject_id, sub.subject_name, ss.grade
                FROM student_subjects ss
                LEFT JOIN subjects sub ON ss.subject_id = sub.subject_id
                WHERE ss.student_id = $1
            `, [studentId]);

            const subjects = subjectsResult.rows;

            const assessmentsResult = await db.query(`
                SELECT a.assessment_id, a.title, a.weight, ar.score, a.subject_id
                FROM assessments a
                LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id
                WHERE ar.student_id = $1
            `, [studentId]);

            const assessments = assessmentsResult.rows;

            const subjectsWithGrades = subjects.map(subject => {
                let totalPercentage = 0;
                let totalWeight = 0;
                assessments.forEach(assessment => {
                    if (assessment.subject_id === subject.subject_id && assessment.score !== null) {
                        totalPercentage += assessment.score * (assessment.weight / 100);
                        totalWeight += assessment.weight;
                    }
                });
                totalPercentage = totalWeight > 0 ? totalPercentage : 0;

                let grade;
                if (totalPercentage >= 90) grade = 'A';
                else if (totalPercentage >= 80) grade = 'B';
                else if (totalPercentage >= 70) grade = 'C';
                else if (totalPercentage >= 60) grade = 'D';
                else grade = 'F';

                return {
                    ...subject,
                    total_percentage: totalPercentage.toFixed(2),
                    grade: grade
                };
            });

            res.render('common/studentDetails', {
                title: 'Student Details',
                student,
                guardians,
                subjects: subjectsWithGrades,
                gradYearGroupName: student.grad_year_group_name || 'No graduation year group assigned'
            });
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Failed to fetch student details');
        }
    });

    app.get('/common/management', isAuthenticated, async (req, res) => {
        try {
            const schoolYears = await db.query(`
                SELECT sy.*, t.*
                FROM school_years sy
                LEFT JOIN terms t ON t.year_id = sy.id
                ORDER BY sy.year_label DESC, t.start_date ASC;
            `);

            let structuredSchoolYears = {};
            schoolYears.rows.forEach(row => {
                if (!structuredSchoolYears[row.id]) {
                    structuredSchoolYears[row.id] = {
                        id: row.id,
                        year_label: row.year_label,
                        terms: []
                    };
                }
                if (row.term_id) {
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
                schoolYears: Object.values(structuredSchoolYears)
            });
        } catch (error) {
            console.error('Error fetching management data:', error);
            res.status(500).send('Failed to load management data');
        }
    });

    app.get('/common/editStudent', isAuthenticated, async (req, res) => {
        const { studentId } = req.query;

        if (!studentId) {
            res.status(400).send('Student ID is required.');
            return;
        }

        try {
            const studentDetails = await db.query('SELECT * FROM students WHERE student_id = $1 AND organization_id = $2', [studentId, req.session.organizationId]);
            if (studentDetails.rows.length === 0) {
                res.status(404).send('Student not found.');
                return;
            }
            const student = studentDetails.rows[0];

            const classes = await db.query('SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);

            const subjectsResult = await db.query('SELECT * FROM subjects WHERE class_id = $1', [student.class_id]);

            const enrolledSubjectsResult = await db.query('SELECT subject_id FROM student_subjects WHERE student_id = $1', [studentId]);
            const enrolledSubjectIds = enrolledSubjectsResult.rows.map(subject => subject.subject_id);

            const guardiansResult = await db.query('SELECT * FROM guardians WHERE student_id = $1', [studentId]);
            const guardians = guardiansResult.rows;

            const gradYearGroupResult = await db.query(`
                SELECT g.name AS grad_year_group_name
                FROM classes c
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1
            `, [student.class_id]);
            const gradYearGroupName = gradYearGroupResult.rows[0]?.grad_year_group_name || 'No graduation year group assigned';

            res.render('common/editStudent', {
                title: 'Edit Student',
                student,
                classes: classes.rows,
                subjects: subjectsResult.rows,
                enrolledSubjects: enrolledSubjectIds,
                guardians,
                gradYearGroupName
            });
        } catch (error) {
            console.error('Error loading edit student page:', error);
            res.status(500).send('Failed to load student details.');
        }
    });

    app.post('/common/editStudent/:studentId', upload.single('studentImage'), isAuthenticated, async (req, res) => {
        const { studentId } = req.params;
        const {
            classId, firstName, lastName, dateOfBirth, height, hometown, subjects = [],
            guardian1FirstName, guardian1LastName, guardian1Address, guardian1Phone, guardian1Hometown,
            guardian2FirstName, guardian2LastName, guardian2Address, guardian2Phone, guardian2Hometown,
            guardian3FirstName, guardian3LastName, guardian3Address, guardian3Phone, guardian3Hometown
        } = req.body;
        const file = req.file;

        try {
            if (file) {
                await db.query(
                    `UPDATE students SET class_id = $1, first_name = $2, last_name = $3, date_of_birth = $4, height = $5, hometown = $6, image_url = $7 WHERE student_id = $8 AND organization_id = $9`,
                    [classId, firstName, lastName, dateOfBirth, height, hometown, file.filename, studentId, req.session.organizationId]
                );
            } else {
                await db.query(
                    `UPDATE students SET class_id = $1, first_name = $2, last_name = $3, date_of_birth = $4, height = $5, hometown = $6 WHERE student_id = $7 AND organization_id = $8`,
                    [classId, firstName, lastName, dateOfBirth, height, hometown, studentId, req.session.organizationId]
                );
            }

            await db.query('DELETE FROM student_subjects WHERE student_id = $1', [studentId]);

            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query('INSERT INTO student_subjects (student_id, subject_id) VALUES ($1, $2)', [studentId, subjectId]);
                }
            }

            const guardians = [
                { firstName: guardian1FirstName, lastName: guardian1LastName, address: guardian1Address, phone: guardian1Phone, hometown: guardian1Hometown },
                { firstName: guardian2FirstName, lastName: guardian2LastName, address: guardian2Address, phone: guardian2Phone, hometown: guardian2Hometown },
                { firstName: guardian3FirstName, lastName: guardian3LastName, address: guardian3Address, phone: guardian3Phone, hometown: guardian3Hometown }
            ];

            for (let i = 0; i < guardians.length; i++) {
                const guardian = guardians[i];
                if (guardian.firstName || guardian.lastName || guardian.address || guardian.phone || guardian.hometown) {
                    await db.query(
                        `INSERT INTO guardians (student_id, first_name, last_name, address, phone, hometown) VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (student_id, first_name, last_name) DO UPDATE SET address = $4, phone = $5, hometown = $6`,
                        [studentId, guardian.firstName, guardian.lastName, guardian.address, guardian.phone, guardian.hometown]
                    );
                }
            }

            res.redirect(`/common/studentDetails?studentId=${studentId}`);
        } catch (error) {
            console.error('Error updating student:', error);
            res.status(500).send('Failed to update student.');
        }
    });

    app.get('/common/deleteStudent', isAuthenticated, async (req, res) => {
        const studentId = req.query.id;
        if (!studentId) {
            return res.redirect('/common/management');
        }
        try {
            const result = await db.query('SELECT * FROM students WHERE student_id = $1 AND organization_id = $2', [studentId, req.session.organizationId]);
            if (result.rows.length > 0) {
                res.render('common/deleteStudent', {
                    title: 'Confirm Delete Student',
                    student: result.rows[0]
                });
            } else {
                return res.redirect('/common/management');
            }
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Error fetching student details');
        }
    });

    app.get('/common/attendance', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        try {
            const termDatesResult = await db.query(`
                SELECT DISTINCT t.start_date, t.end_date
                FROM terms t
                JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE tc.class_id = $1
                ORDER BY t.start_date`, [classId]);
    
            const dates = [];
            termDatesResult.rows.forEach(row => {
                let currentDate = new Date(row.start_date);
                const endDate = new Date(row.end_date);
                while (currentDate <= endDate) {
                    dates.push(currentDate.toISOString().split('T')[0]);
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
    
            // Fetch students using the common function
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
    
            const attendanceResult = await db.query(`
                SELECT student_id, date, status
                FROM attendance_records
                WHERE class_id = $1`, [classId]);
    
            const attendanceMap = {};
            attendanceResult.rows.forEach(record => {
                if (!attendanceMap[record.student_id]) {
                    attendanceMap[record.student_id] = {};
                }
                attendanceMap[record.student_id][record.date.toISOString().split('T')[0]] = record.status;
            });
    
            res.render('common/attendance', {
                title: 'Attendance',
                classId,
                dates,
                students,
                attendanceMap
            });
        } catch (error) {
            console.error('Error fetching attendance data:', error);
            res.status(500).send('Error loading attendance page');
        }
    });
    
    app.post('/common/saveAttendanceForDate', isAuthenticated, async (req, res) => {
        const { attendance, classId } = req.body;

        try {
            for (const record of attendance) {
                const { studentId, date, status } = record;
                await db.query(`
                    INSERT INTO attendance_records (student_id, class_id, date, status, marked_by, marked_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    ON CONFLICT (student_id, class_id, date)
                    DO UPDATE SET status = $4, updated_at = NOW()
                `, [studentId, classId, date, status, req.session.userId]);
            }

            res.json({ success: true, message: 'Attendance saved successfully.' });
        } catch (error) {
            console.error('Error saving attendance:', error);
            res.status(500).json({ success: false, message: 'Failed to save attendance.' });
        }
    });

    app.get('/common/attendanceCollection', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        try {
            // Fetch class name
            const classResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            if (classResult.rows.length === 0) {
                return res.status(404).send('Class not found');
            }
            const className = classResult.rows[0].class_name;
    
            // Fetch term dates for the specified class
            const termDatesResult = await db.query(`
                SELECT DISTINCT t.start_date, t.end_date
                FROM terms t
                JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE tc.class_id = $1
                ORDER BY t.start_date
            `, [classId]);
    
            const dates = [];
            termDatesResult.rows.forEach(row => {
                let currentDate = new Date(row.start_date);
                const endDate = new Date(row.end_date);
                while (currentDate <= endDate) {
                    dates.push(currentDate.toISOString().split('T')[0]);
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
    
            // Fetch students using the common function
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
    
            // Fetch attendance records
            const attendanceResult = await db.query(`
                SELECT student_id, date, status
                FROM attendance_records
                WHERE class_id = $1
            `, [classId]);
    
            const attendanceMap = {};
            attendanceResult.rows.forEach(record => {
                if (!attendanceMap[record.student_id]) {
                    attendanceMap[record.student_id] = {};
                }
                attendanceMap[record.student_id][record.date.toISOString().split('T')[0]] = record.status;
            });
    
            res.render('common/attendanceCollection', {
                title: 'Attendance Records',
                classId,
                className,
                dates,
                students,
                attendanceMap
            });
        } catch (error) {
            console.error('Error fetching attendance data:', error);
            res.status(500).send('Error loading attendance records page');
        }
    });
    
    app.get('/common/createEmployee', isAuthenticated, async (req, res) => {
        try {
            const query = `
                SELECT c.class_id, c.class_name, g.name AS graduation_year_group_name
                FROM classes c
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.organization_id = $1
                ORDER BY c.class_name ASC;
            `;
            const result = await db.query(query, [req.session.organizationId]);
            res.render('common/createEmployee', {
                title: 'Create Employee',
                classes: result.rows
            });
        } catch (err) {
            console.error('Error fetching classes:', err);
            res.status(500).send('Error fetching classes');
        }
    });

    app.post('/common/createEmployee', isAuthenticated, async (req, res) => {
        const { firstName, lastName, email, password, role, classId } = req.body;

        if (!firstName || !lastName || !email || !password || !role) {
            return res.status(400).send('All fields are required.');
        }

        try {
            // Hash the password before saving to the database
            const hashedPassword = await bcrypt.hash(password, 10);

            // Insert the new employee into the users table
            const result = await db.query(
                `INSERT INTO users (first_name, last_name, email, password, account_type, organization_id)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
                [firstName, lastName, email, hashedPassword, role, req.session.organizationId]
            );

            const userId = result.rows[0].user_id;

            // You can handle the class association here if needed
            if (classId) {
                await db.query(
                    'UPDATE classes SET created_by = $1 WHERE class_id = $2 AND organization_id = $3',
                    [userId, classId, req.session.organizationId]
                );
            }

            req.flash('success', 'Employee created successfully.');
            res.redirect('/common/createEmployee');
        } catch (error) {
            console.error('Error creating employee:', error);
            req.flash('error', 'Failed to create employee.');
            res.redirect('/common/createEmployee');
        }
    });


    app.get('/common/assessment', isAuthenticated, async (req, res) => {
        const { classId, subjectId } = req.query;
        if (!classId || !subjectId) {
            return res.status(400).send('Class ID and Subject ID are required for the assessment.');
        }
    
        try {
            const classNameResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            const subjectNameResult = await db.query('SELECT subject_name FROM subjects WHERE subject_id = $1 AND organization_id = $2', [subjectId, req.session.organizationId]);
    
            if (classNameResult.rows.length === 0 || subjectNameResult.rows.length === 0) {
                return res.status(404).send('Class or Subject not found.');
            }
    
            const className = classNameResult.rows[0].class_name;
            const subjectName = subjectNameResult.rows[0].subject_name;
    
            // Fetch students using the common function
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
    
            const assessmentsResult = await db.query(`
                SELECT a.assessment_id, a.title, a.weight
                FROM assessments a
                WHERE a.class_id = $1 AND a.subject_id = $2 AND a.organization_id = $3
                ORDER BY a.assessment_id`, [classId, subjectId, req.session.organizationId]);
    
            const resultsResult = await db.query(`
                SELECT ar.assessment_id, ar.student_id, ar.score
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3`, [classId, subjectId, req.session.organizationId]);
    
            const results = resultsResult.rows;
    
            const studentScores = {};
            results.forEach(result => {
                if (!studentScores[result.student_id]) {
                    studentScores[result.student_id] = {};
                }
                studentScores[result.student_id][result.assessment_id] = result.score;
            });
    
            students.forEach(student => {
                student.scores = studentScores[student.student_id] || {};
                let totalPercentage = 0;
                assessmentsResult.rows.forEach(assessment => {
                    const score = student.scores[assessment.assessment_id];
                    if (score !== undefined) {
                        totalPercentage += score * (assessment.weight / 100);
                    }
                });
                student.total_percentage = totalPercentage;
                student.grade = calculateGrade(totalPercentage);
            });
    
            res.render('common/assessment', {
                title: `${subjectName} Assessment for ${className}`,
                className: className,
                subjectName: subjectName,
                students: students,
                assessments: assessmentsResult.rows,
                results: results,
                classId,
                subjectId
            });
        } catch (err) {
            console.error('Error on /common/assessment route:', err);
            res.status(500).send('Error loading assessment data.');
        }
    });
        

    function calculateGrade(totalPercentage) {
        if (totalPercentage >= 90) return 'A';
        if (totalPercentage >= 80) return 'B';
        if (totalPercentage >= 70) return 'C';
        if (totalPercentage >= 60) return 'D';
        return 'F';
    }

    app.post('/createTest', isAuthenticated, async (req, res) => {
        const { testName, testWeight, classId, subjectId } = req.body;
        if (!testName || isNaN(parseFloat(testWeight)) || !classId || !subjectId) {
            return res.status(400).send("Missing or invalid input");
        }

        try {
            const result = await db.query(
                'INSERT INTO assessments (title, weight, class_id, subject_id, created_by, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', 
                [testName, parseFloat(testWeight), classId, subjectId, req.session.userId, req.session.organizationId]
            );
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

    app.get('/common/getAssessments', isAuthenticated, async (req, res) => {
        const { classId, subjectId } = req.query;

        try {
            const result = await db.query(
                'SELECT * FROM assessments WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 ORDER BY assessment_id ASC', 
                [classId, subjectId, req.session.organizationId]
            );
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching assessments:', error);
            res.status(500).send('Failed to fetch assessments');
        }
    });

    app.get('/common/getScores', isAuthenticated, async (req, res) => {
        const { classId, subjectId } = req.query;

        try {
            const result = await db.query(`
                SELECT ar.student_id, ar.assessment_id, ar.score, s.first_name, s.last_name
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3
                ORDER BY ar.assessment_id ASC, s.student_id ASC
            `, [classId, subjectId, req.session.organizationId]);

            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching scores:', error);
            res.status(500).send('Failed to fetch scores');
        }
    });

    app.post('/common/updateAssessment', isAuthenticated, async (req, res) => {
        const { assessmentId, title, weight } = req.body;
        try {
            const results = await db.query('UPDATE assessments SET title = $1, weight = $2 WHERE assessment_id = $3 AND organization_id = $4 RETURNING *', [title, parseFloat(weight), assessmentId, req.session.organizationId]);
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

    app.post('/common/saveScores', isAuthenticated, async (req, res) => {
        const { scores } = req.body;

        try {
            for (const { studentId, assessmentId, score } of scores) {
                await db.query(`
                    INSERT INTO assessment_results (student_id, assessment_id, score, organization_id)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (student_id, assessment_id)
                    DO UPDATE SET score = EXCLUDED.score, organization_id = EXCLUDED.organization_id;
                `, [studentId, assessmentId, score, req.session.organizationId]);
            }

            const classId = (await db.query('SELECT class_id FROM assessments WHERE assessment_id = $1 AND organization_id = $2', [scores[0].assessmentId, req.session.organizationId])).rows[0].class_id;
            for (const { studentId } of scores) {
                const totalResult = await db.query(`
                    SELECT SUM(a.weight * ar.score / 100) as total_percentage
                    FROM assessments a
                    JOIN assessment_results ar ON a.assessment_id = ar.assessment_id
                    WHERE ar.student_id = $1 AND a.class_id = $2 AND a.organization_id = $3
                `, [studentId, classId, req.session.organizationId]);

                const totalPercentage = totalResult.rows[0].total_percentage || 0;

                let grade;
                if (totalPercentage >= 90) grade = 'A';
                else if (totalPercentage >= 80) grade = 'B';
                else if (totalPercentage >= 70) grade = 'C';
                else if (totalPercentage >= 60) grade = 'D';
                else grade = 'F';

                await db.query('UPDATE students SET total_percentage = $1, grade = $2 WHERE student_id = $3 AND organization_id = $4', [totalPercentage, grade, studentId, req.session.organizationId]);
            }

            res.json({ success: true, message: "Scores and total percentage updated successfully." });
        } catch (err) {
            console.error('Error saving scores:', err);
            res.status(500).send("Failed to save scores.");
        }
    });

    app.get('/common/getSubjectsForClass', isAuthenticated, async (req, res) => {
        const { classId } = req.query;

        if (!classId) {
            return res.status(400).json({ error: 'Class ID is required.' });
        }

        try {
            const subjectsResult = await db.query('SELECT * FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name', [classId, req.session.organizationId]);
            res.json(subjectsResult.rows);
        } catch (error) {
            console.error('Error fetching subjects:', error);
            res.status(500).json({ error: 'Failed to load subjects.' });
        }
    });

    app.get('/api/getSubjectsForClass', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        if (!classId) {
            return res.status(400).json({ message: "Class ID is required" });
        }
        try {
            const result = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching subjects:', error);
            res.status(500).json({ message: 'Failed to fetch subjects.' });
        }
    });



    async function fetchStudentsByClass(db, classId, organizationId) {
        try {
            const studentsResult = await db.query(`
                SELECT student_id, first_name, last_name
                FROM students
                WHERE class_id = $1
                ORDER BY first_name, last_name
            `, [classId]);
            return studentsResult.rows;
        } catch (error) {
            console.error('Error fetching students:', error);
            throw error;
        }
    }
    

    app.get('/common/classDashboard', isAuthenticated, async (req, res) => {
        const classId = req.query.classId;
        if (!classId) {
            res.redirect('/common/orgDashboard');
            return;
        }
        try {
            const classResult = await db.query(`
                SELECT c.class_name, g.name as graduation_year_group_name
                FROM classes c
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1 AND c.organization_id = $2`, [classId, req.session.organizationId]);
    
            if (classResult.rows.length === 0) {
                console.error('Class details not found');
                return res.status(500).send('Error fetching class details or class not found');
            }
    
            const className = classResult.rows[0].class_name;
            const graduationYearGroupName = classResult.rows[0].graduation_year_group_name;
    
            // Fetch students using the common function
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
    
            // Fetch subjects for the specified class
            const subjectsResult = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name', [classId, req.session.organizationId]);
    
    
            res.render('common/classDashboard', {
                title: 'Class Dashboard - ' + className,
                className: className,
                graduationYearGroup: graduationYearGroupName,
                students: students,
                subjects: subjectsResult.rows,
                classId: classId,
                attendanceLink: `/common/attendanceCollection?classId=${classId}`
            });
        } catch (err) {
            console.error('Error fetching data:', err);
            res.status(500).send('Error loading class dashboard');
        }
    });
    


    app.get('/common/assessment', isAuthenticated, async (req, res) => {
        const { classId, subjectId } = req.query;
        if (!classId || !subjectId) {
            return res.status(400).send('Class ID and Subject ID are required for the assessment.');
        }
    
        try {
            const classNameResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            const subjectNameResult = await db.query('SELECT subject_name FROM subjects WHERE subject_id = $1 AND organization_id = $2', [subjectId, req.session.organizationId]);
    
            if (classNameResult.rows.length === 0 || subjectNameResult.rows.length === 0) {
                return res.status(404).send('Class or Subject not found.');
            }
    
            const className = classNameResult.rows[0].class_name;
            const subjectName = subjectNameResult.rows[0].subject_name;
    
            // Fetch students using the common function
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
    
            const assessmentsResult = await db.query(`
                SELECT a.assessment_id, a.title, a.weight
                FROM assessments a
                WHERE a.class_id = $1 AND a.subject_id = $2 AND a.organization_id = $3
                ORDER BY a.assessment_id`, [classId, subjectId, req.session.organizationId]);
    
            const resultsResult = await db.query(`
                SELECT ar.assessment_id, ar.student_id, ar.score
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3`, [classId, subjectId, req.session.organizationId]);
    
            const results = resultsResult.rows;
    
            const studentScores = {};
            results.forEach(result => {
                if (!studentScores[result.student_id]) {
                    studentScores[result.student_id] = {};
                }
                studentScores[result.student_id][result.assessment_id] = result.score;
            });
    
            students.forEach(student => {
                student.scores = studentScores[student.student_id] || {};
                let totalPercentage = 0;
                assessmentsResult.rows.forEach(assessment => {
                    const score = student.scores[assessment.assessment_id];
                    if (score !== undefined) {
                        totalPercentage += score * (assessment.weight / 100);
                    }
                });
                student.total_percentage = totalPercentage;
                student.grade = calculateGrade(totalPercentage);
            });
    
            res.render('common/assessment', {
                title: `${subjectName} Assessment for ${className}`,
                className: className,
                subjectName: subjectName,
                students: students,
                assessments: assessmentsResult.rows,
                results: results,
                classId,
                subjectId
            });
        } catch (err) {
            console.error('Error on /common/assessment route:', err);
            res.status(500).send('Error loading assessment data.');
        }
    });
                
    
    // app.post('/common/registerSchoolYear', isAuthenticated, async (req, res) => {
    //     const { schoolYear, terms } = req.body;
    //     try {
    //         const yearResult = await db.query('INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id', [schoolYear, req.session.organizationId]);
    //         const schoolYearId = yearResult.rows[0].id;

    //         for (const term of terms) {
    //             const termResult = await db.query('INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id', [term.termName, term.startDate, term.endDate, schoolYearId, req.session.organizationId]);
    //             const termId = termResult.rows[0].term_id;

    //             for (const classId of term.selectedClasses) {
    //                 await db.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, classId]);
    //             }
    //         }

    //         res.json({ success: true });
    //     } catch (error) {
    //         console.error('Error registering school year:', error);
    //         res.status(500).send('Error registering school year');
    //     }
    // });

    app.post('/common/registerSchoolYear', isAuthenticated, async (req, res) => {
        const { schoolYear, terms } = req.body;
        try {
            const yearResult = await db.query('INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id', [schoolYear, req.session.organizationId]);
            const schoolYearId = yearResult.rows[0].id;

            for (const term of terms) {
                const termResult = await db.query('INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id', [term.termName, term.startDate, term.endDate, schoolYearId, req.session.organizationId]);
                const termId = termResult.rows[0].term_id;

                for (const classId of term.selectedClasses) {
                    await db.query('INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)', [termId, classId, req.session.organizationId]);
                }
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Error registering school year:', error);
            res.status(500).send('Error registering school year');
        }
    });

    app.get('/api/getClasses', isAuthenticated, async (req, res) => {
        try {
            const result = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).json({ error: 'Failed to load classes.' });
        }
    });

    app.get('/common/getClasses', isAuthenticated, async (req, res) => {
        try {
            const { rows: classes } = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name', [req.session.organizationId]);
            res.json(classes);
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).json({ message: 'Failed to fetch classes' });
        }
    });

    app.post('/common/registerSchoolYearEvent', isAuthenticated, async (req, res) => {
        try {
            await db.query('INSERT INTO school_events (name, event_date, details, organization_id) VALUES ($1, $2, $3, $4)', [req.body.eventName, req.body.startDate, req.body.eventDetails, req.session.organizationId]);
            res.redirect('/common/management');
        } catch (error) {
            console.error('Error adding event:', error);
            res.status(500).send('Error processing your request');
        }
    });

    app.post('/common/registerSchoolYearAnnouncement', isAuthenticated, async (req, res) => {
        try {
            await db.query('INSERT INTO announcements (message, organization_id) VALUES ($1, $2)', [req.body.announcement, req.session.organizationId]);
            res.redirect('/common/management');
        } catch (error) {
            console.error('Error posting announcement:', error);
            res.status(500).send('Error processing your request');
        }
    });

    app.get('/common/registerSchoolYear', isAuthenticated, (req, res) => {
        res.render('common/registerSchoolYear', {
            title: 'Register School Year'
        });
    });

    app.post('/common/registerSchoolYear', isAuthenticated, async (req, res) => {
        const { schoolYear } = req.body;
        try {
            const yearResult = await db.query('INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id', [schoolYear, req.session.organizationId]);
            const yearId = yearResult.rows[0].id;

            for (let i = 1; i <= 4; i++) {
                const termName = req.body[`termName${i}`];
                const startDate = req.body[`startDate${i}`];
                const endDate = req.body[`endDate${i}`];
                if (termName) {
                    await db.query('INSERT INTO terms (year_id, term_name, start_date, end_date, organization_id) VALUES ($1, $2, $3, $4, $5)', [yearId, termName, startDate || null, endDate || null, req.session.organizationId]);
                }
            }

            res.redirect('/common/orgDashboard');
        } catch (error) {
            console.error('Failed to register school year and terms:', error);
            res.status(500).send('Error processing your request');
        }
    });

    app.delete('/common/deleteEvent', isAuthenticated, async (req, res) => {
        const { eventId } = req.body;
        if (!eventId) {
            return res.status(400).json({ success: false, message: "Event ID is required." });
        }

        try {
            const result = await db.query('DELETE FROM school_events WHERE id = $1 AND organization_id = $2 RETURNING *', [eventId, req.session.organizationId]);
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

    app.delete('/common/deleteAnnouncement', isAuthenticated, async (req, res) => {
        const { announcementId } = req.body;
        try {
            await db.query('DELETE FROM announcements WHERE announcement_id = $1 AND organization_id = $2', [announcementId, req.session.organizationId]);
            res.json({ success: true, message: 'Announcement deleted successfully.' });
        } catch (error) {
            console.error('Error deleting announcement:', error);
            res.status(500).json({ success: false, message: 'Failed to delete announcement.' });
        }
    });

    app.delete('/common/deleteSchoolYear', isAuthenticated, async (req, res) => {
        try {
            const { id: yearId } = req.body;
    
            // Delete all term_classes associated with the terms of the school year
            await db.query(`
                DELETE FROM term_classes
                WHERE term_id IN (SELECT term_id FROM terms WHERE school_year_id = $1)
            `, [yearId]);
    
            // Delete all terms associated with the school year
            await db.query('DELETE FROM terms WHERE school_year_id = $1', [yearId]);
    
            // Delete the school year
            await db.query('DELETE FROM school_years WHERE id = $1', [yearId]);
    
            res.json({ success: true, message: 'School year deleted successfully.' });
        } catch (error) {
            console.error('Error deleting school year:', error);
            res.status(500).json({ success: false, message: 'Failed to delete school year.' });
        }
    });
    
        

    app.post('/common/deleteSchoolYear', isAuthenticated, async (req, res) => {
        try {
            const { yearId } = req.body;
    
            // Delete all terms associated with the school year
            await db.query('DELETE FROM terms WHERE school_year_id = $1', [yearId]);
    
            // Delete the school year
            await db.query('DELETE FROM school_years WHERE id = $1', [yearId]);
    
            req.flash('success', 'School year deleted successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error deleting school year:', error);
            req.flash('error', 'Failed to delete school year.');
            res.redirect('/common/manageRecords');
        }
    });
    
    

    async function getSchoolYearsData(db, organizationId) {
        // Fetch school years
        const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
        const schoolYears = schoolYearsResult.rows;

        // Fetch terms and associated classes for each school year
        for (const year of schoolYears) {
            const termsResult = await db.query('SELECT * FROM terms WHERE year_id = $1 AND organization_id = $2 ORDER BY start_date', [year.id, organizationId]);
            const terms = termsResult.rows;

            for (const term of terms) {
                const termClassesResult = await db.query(
                    `SELECT tc.class_id, c.class_name 
                     FROM term_classes tc
                     JOIN classes c ON tc.class_id = c.class_id
                     WHERE tc.term_id = $1`,
                    [term.term_id]
                );
                term.class_ids = termClassesResult.rows.map(row => row.class_id);
                term.classes = termClassesResult.rows;
            }

            year.terms = terms;
        }

        return schoolYears;
    }

    // app.get('/common/manageRecords', isAuthenticated, async (req, res) => {
    //     try {
    //         const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1', [req.session.organizationId]);
    //         const termsResult = await db.query(`
    //             SELECT t.*, array_agg(tc.class_id) AS classes
    //             FROM terms t
    //             LEFT JOIN term_classes tc ON t.term_id = tc.term_id
    //             WHERE t.organization_id = $1
    //             GROUP BY t.term_id
    //         `, [req.session.organizationId]);
    //         const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);
    //         const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1', [req.session.organizationId]);
    //         const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1', [req.session.organizationId]);

    //         const schoolYears = schoolYearsResult.rows.map(schoolYear => {
    //             const terms = termsResult.rows.filter(term => term.school_year_id === schoolYear.id);
    //             return { ...schoolYear, terms };
    //         });

    //         res.render('common/manageRecords', {
    //             title: 'Manage Records',
    //             schoolYears,
    //             classes: classesResult.rows,
    //             events: eventsResult.rows,
    //             announcements: announcementsResult.rows
    //         });
    //     } catch (error) {
    //         console.error('Error fetching data:', error);
    //         res.status(500).send('Error loading manage records page.');
    //     }
    // });

    app.get('/common/manageRecords', isAuthenticated, async (req, res) => {
        try {
            const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1', [req.session.organizationId]);
            const termsResult = await db.query(`
                SELECT t.*, array_agg(tc.class_id) AS classes
                FROM terms t
                LEFT JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE t.organization_id = $1
                GROUP BY t.term_id
            `, [req.session.organizationId]);
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);
            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1', [req.session.organizationId]);
            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1', [req.session.organizationId]);

            const schoolYears = schoolYearsResult.rows.map(schoolYear => {
                const terms = termsResult.rows.filter(term => term.school_year_id === schoolYear.id);
                return { ...schoolYear, terms };
            });

            res.render('common/manageRecords', {
                title: 'Manage Records',
                schoolYears,
                classes: classesResult.rows,
                events: eventsResult.rows,
                announcements: announcementsResult.rows
            });
        } catch (error) {
            console.error('Error fetching data:', error);
            res.status(500).send('Error loading manage records page.');
        }
    });


    app.get('/common/orgDashboard', isAuthenticated, async (req, res) => {
        try {
            const { organizationId } = req.session;
    
            // Fetch the current school year and its terms
            const schoolYearResult = await db.query(`
                SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1 AND sy.current = TRUE
                ORDER BY t.start_date
            `, [organizationId]);
    
            let schoolYear = null;
            let currentTerm = null;
            if (schoolYearResult.rows.length > 0) {
                schoolYear = {
                    id: schoolYearResult.rows[0].school_year_id,
                    year_label: schoolYearResult.rows[0].year_label,
                    terms: schoolYearResult.rows.map(row => ({
                        term_id: row.term_id,
                        term_name: row.term_name,
                        start_date: row.start_date,
                        end_date: row.end_date,
                        current: row.current
                    }))
                };
    
                currentTerm = schoolYearResult.rows.find(row => row.current);
            }
    
            // Fetch classes
            const classesResult = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name', [organizationId]);
            const classes = classesResult.rows;
    
            // Fetch events
            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date', [organizationId]);
            const events = eventsResult.rows;
    
            // Fetch announcements
            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 ORDER BY announcement_id DESC', [organizationId]);
            const announcements = announcementsResult.rows;
    
            res.render('common/orgDashboard', {
                title: 'Organization Dashboard',
                schoolYear,
                currentTerm,
                classes,
                events,
                announcements,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            req.flash('error', 'Failed to load dashboard data.');
            res.redirect('/');
        }
    });
    
    app.post('/common/updateSchoolYearAndTerms', isAuthenticated, async (req, res) => {
        try {
            const { yearId, year_label, currentYear, termIds, termNames, startDates, endDates, currentTerm, termClasses } = req.body;
            const { organizationId } = req.session;

            await db.query('UPDATE school_years SET year_label = $1, current = $2 WHERE id = $3 AND organization_id = $4', [year_label, currentYear === 'true', yearId, organizationId]);

            // Unset current term for all terms of this organization
            await db.query('UPDATE terms SET current = FALSE WHERE school_year_id IN (SELECT id FROM school_years WHERE organization_id = $1)', [organizationId]);

            for (let i = 0; i < termIds.length; i++) {
                const termId = termIds[i];
                const termName = termNames[i];
                const startDate = startDates[i];
                const endDate = endDates[i];
                const isCurrent = currentTerm && currentTerm.includes(termId);

                await db.query(
                    'UPDATE terms SET term_name = $1, start_date = $2, end_date = $3, current = $4 WHERE term_id = $5 AND organization_id = $6',
                    [termName, startDate, endDate, isCurrent, termId, organizationId]
                );

                await db.query('DELETE FROM term_classes WHERE term_id = $1', [termId]);
                if (termClasses && termClasses[i]) {
                    for (const classId of termClasses[i]) {
                        await db.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, classId]);
                    }
                }
            }

            req.flash('success', 'School year and terms updated successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating school year and terms:', error);
            req.flash('error', 'Failed to update school year and terms.');
            res.redirect('/common/manageRecords');
        }
    });    


    app.post('/common/updateEvent', isAuthenticated, async (req, res) => {
        try {
            await db.query('UPDATE school_events SET name = $1, event_date = $2, details = $3 WHERE id = $4 AND organization_id = $5', [req.body.name, req.body.event_date, req.body.details, req.body.id, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating event:', error);
            res.status(500).send('Failed to update event.');
        }
    });

    app.post('/common/updateAnnouncement', isAuthenticated, async (req, res) => {
        const { announcementId, message } = req.body;
        try {
            await db.query('UPDATE announcements SET message = $1 WHERE announcement_id = $2 AND organization_id = $3', [message, announcementId, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating announcement:', error);
            res.status(500).send('Failed to update announcement.');
        }
    });

// Add Class and Subject Form Route
app.get('/common/addClassSubject', isAuthenticated, async (req, res) => {
    try {
        const { organizationId } = req.session;

        const classResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [organizationId]);
        const classes = classResult.rows;

        const subjectResult = await db.query('SELECT * FROM subjects WHERE organization_id = $1', [organizationId]);
        const subjects = subjectResult.rows;

        const gradYearGroupsResult = await db.query('SELECT * FROM graduation_year_groups WHERE organization_id = $1', [organizationId]);
        const availableGradYearGroups = gradYearGroupsResult.rows;

        res.render('common/addClassSubject', {
            title: 'Add Class and Subject',
            classes,
            subjects,
            availableGradYearGroups,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching data:', error);
        req.flash('error', 'Failed to load the form for adding a class and subject.');
        res.redirect('/common/orgDashboard');
    }
});

 
// Add Class POST Route
app.post('/common/addClass', isAuthenticated, async (req, res) => {
    const { className, gradYearGroupId } = req.body;
    const { organizationId } = req.session;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Insert class
        await client.query(
            'INSERT INTO classes (class_name, organization_id, graduation_year_group_id) VALUES ($1, $2, $3)',
            [className, organizationId, gradYearGroupId]
        );

        await client.query('COMMIT');
        req.flash('success', 'Class added successfully.');
        res.redirect('/common/addClassSubject');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding class:', error);
        req.flash('error', 'Failed to add class.');
        res.redirect('/common/addClassSubject');
    } finally {
        client.release();
    }
});

    app.get('/common/addSubject', isAuthenticated, async (req, res) => {
        try {
            const result = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name', [req.session.organizationId]);
            res.render('common/addSubject', {
                title: 'Add New Subject',
                classes: result.rows
            });
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).send('Failed to load the form for adding a subject.');
        }
    });

// Add Subject POST Route
app.post('/common/addSubject', isAuthenticated, async (req, res) => {
    const { subjectName, classId } = req.body;
    const { organizationId } = req.session;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Insert subject
        await client.query(
            'INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3)',
            [subjectName, classId, organizationId]
        );

        await client.query('COMMIT');
        req.flash('success', 'Subject added successfully.');
        res.redirect('/common/addClassSubject');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding subject:', error);
        req.flash('error', 'Failed to add subject.');
        res.redirect('/common/addClassSubject');
    } finally {
        client.release();
    }
});

    app.post('/common/updateTerm', isAuthenticated, async (req, res) => {
        const { term_id, term_name, start_date, end_date } = req.body;
        try {
            await db.query('UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5', [term_name, start_date, end_date, term_id, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Failed to update term:', error);
            res.status(500).send('Error updating term');
        }
    });

    app.delete('/common/deleteTerm', isAuthenticated, async (req, res) => {
        const { term_id } = req.body;
        try {
            await db.query('DELETE FROM terms WHERE term_id = $1 AND organization_id = $2', [term_id, req.session.organizationId]);
            res.json({ success: true, message: 'Term deleted successfully.' });
        } catch (error) {
            console.error('Error deleting term:', error);
            res.status(500).json({ success: false, message: 'Failed to delete term.' });
        }
    });

// Add Graduation Year Group POST Route
app.post('/addGraduationYearGroup', isAuthenticated, async (req, res) => {
    const { graduationYear } = req.body;
    const yearGroup = `Graduation Class of ${graduationYear} Group`;

    try {
        const result = await db.query(
            'INSERT INTO graduation_year_groups (name, organization_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id',
            [yearGroup, req.session.organizationId]
        );

        if (result.rows.length > 0) {
            req.flash('success', 'Graduation year group added successfully.');
        } else {
            req.flash('info', 'Graduation year group already exists.');
        }

        res.redirect('/common/addClassSubject');
    } catch (error) {
        console.error('Error adding graduation year group:', error);
        req.flash('error', 'Failed to add graduation year group.');
        res.redirect('/common/addClassSubject');
    }
});


    app.get('/common/manageClassSubjectAndGradYr', isAuthenticated, async (req, res) => {
        try {
            const graduationYearsResult = await db.query('SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name', [req.session.organizationId]);
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name', [req.session.organizationId]);
            const subjectsResult = await db.query('SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name', [req.session.organizationId]);

            res.render('common/manageClassSubjectAndGradYr', {
                title: 'Modify Class, Subject & Grad Year',
                graduationYearGroups: graduationYearsResult.rows,
                classes: classesResult.rows,
                subjects: subjectsResult.rows
            });
        } catch (error) {
            console.error('Error fetching data:', error);
            res.status(500).send('Error loading the management page.');
        }
    });

    app.get('/deleteGraduationYearGroup', isAuthenticated, async (req, res) => {
        try {
            const { id } = req.query;
            await db.query('DELETE FROM graduation_year_groups WHERE id = $1 AND organization_id = $2', [id, req.session.organizationId]);
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error deleting graduation year group:', error);
            res.status(500).send('Failed to delete graduation year group.');
        }
    });

    app.post('/editGraduationYearGroup', isAuthenticated, async (req, res) => {
        const { id, newName } = req.body;
        try {
            await db.query('UPDATE graduation_year_groups SET name = $1 WHERE id = $2 AND organization_id = $3', [newName, id, req.session.organizationId]);
            res.redirect('common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error updating graduation year group:', error);
            res.redirect('common/manageClassSubjectAndGradYr', { error: 'Failed to update graduation year group.' });
        }
    });

    app.get('/deleteClass', isAuthenticated, async (req, res) => {
        try {
            const { classId } = req.query;
            await db.query('DELETE FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error deleting class:', error);
            res.status(500).send('Failed to delete class.');
        }
    });

    app.post('/editClass', isAuthenticated, async (req, res) => {
        const { classId, newClassName } = req.body;
        try {
            await db.query('UPDATE classes SET class_name = $1 WHERE class_id = $2 AND organization_id = $3', [newClassName, classId, req.session.organizationId]);
            res.redirect('common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error updating class:', error);
            res.redirect('common/manageClassSubjectAndGradYr', { error: 'Failed to update class.' });
        }
    });

    app.get('/api/getSubjectsByClass', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        try {
            const result = await db.query('SELECT * FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name', [classId, req.session.organizationId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching subjects for class:', error);
            res.status(500).json({ message: 'Failed to fetch subjects.' });
        }
    });

    app.post('/api/editSubject', isAuthenticated, async (req, res) => {
        const { subjectId, newName } = req.query;
        try {
            await db.query('UPDATE subjects SET subject_name = $1 WHERE subject_id = $2 AND organization_id = $3', [newName, subjectId, req.session.organizationId]);
            res.json({ success: true, message: 'Subject updated successfully.' });
        } catch (error) {
            console.error('Error updating subject:', error);
            res.status(500).json({ success: false, message: 'Failed to update subject.' });
        }
    });

    app.delete('/api/deleteSubject', isAuthenticated, async (req, res) => {
        const { subjectId } = req.query;
        try {
            await db.query('DELETE FROM subjects WHERE subject_id = $1 AND organization_id = $2', [subjectId, req.session.organizationId]);
            res.json({ success: true, message: 'Subject deleted successfully.' });
        } catch (error) {
            console.error('Error deleting subject:', error);
            res.status(500).json({ success: false, message: 'Failed to delete subject.' });
        }
    });

    app.get('/api/getGradYearGroupByClassId', isAuthenticated, async (req, res) => {
        const { classId } = req.query;
        if (!classId) {
            return res.status(400).json({ error: "Class ID is required" });
        }
        try {
            const result = await db.query(`
                SELECT g.name as grad_year_group_name
                FROM classes c
                JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1 AND c.organization_id = $2`, [classId, req.session.organizationId]);

            if (result.rows.length > 0) {
                res.json({ grad_year_group_name: result.rows[0].grad_year_group_name });
            } else {
                res.status(404).json({ error: "Graduation year group not found for the given class ID." });
            }
        } catch (err) {
            console.error('Error fetching graduation year group:', err);
            res.status(500).json({ error: 'Failed to fetch graduation year group data.' });
        }
    });

    app.get('/common/manageStudents', isAuthenticated, async (req, res) => {
        try {
            const classes = await db.query('SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name', [req.session.organizationId]);
            res.render('common/manageStudents', {
                title: 'Select Class',
                classes: classes.rows
            });
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).send('Error loading class selection page');
        }
    });

    app.get('/common/studentListByClass', isAuthenticated, async (req, res) => {
        const classId = req.query.classId;
        try {
            const students = await db.query(`
                SELECT student_id, first_name, last_name
                FROM students
                WHERE class_id = $1 AND organization_id = $2
                ORDER BY first_name, last_name`, [classId, req.session.organizationId]);

            const classInfo = await db.query(`
                SELECT class_name
                FROM classes
                WHERE class_id = $1 AND organization_id = $2`, [classId, req.session.organizationId]);

            if (classInfo.rows.length > 0) {
                res.render('common/studentListByClass', {
                    title: `Students in ${classInfo.rows[0].class_name}`,
                    students: students.rows,
                    className: classInfo.rows[0].class_name,
                    classId: classId
                });
            } else {
                res.status(404).send("Class not found");
            }
        } catch (error) {
            console.error('Error fetching students:', error);
            res.status(500).send('Error loading students list');
        }
    });

};
