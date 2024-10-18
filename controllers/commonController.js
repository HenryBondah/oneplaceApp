const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
require('dotenv').config(); // Load environment variables from .env file
const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');

// Configure AWS S3
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Setup multer for file uploads
const storage = multerS3({
    s3: s3,
    bucket: BUCKET_NAME,
    acl: 'public-read',
    key: function (req, file, cb) {
        cb(null, Date.now().toString() + '-' + file.originalname);
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
async function getClassName(db, classId) {
    const result = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [classId]);
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

async function getClassesWithEmployees(db, organizationId) {
    const classesQuery = `
        SELECT c.class_id, c.class_name,
            json_agg(json_build_object('name', u.first_name || ' ' || u.last_name, 'on_hold', u.on_hold, 'main', uc.main)) AS employees
        FROM classes c
        LEFT JOIN user_classes uc ON c.class_id = uc.class_id
        LEFT JOIN users u ON uc.user_id = u.user_id
        WHERE c.organization_id = $1
        GROUP BY c.class_id
        ORDER BY c.class_name;
    `;
    const result = await db.query(classesQuery, [organizationId]);
    return result.rows;
}

async function getClassEmployeesWithMain(db, classId) {
    const employeesQuery = `
        SELECT u.user_id, u.first_name || ' ' || u.last_name as name, uc.main
        FROM users u
        JOIN user_classes uc ON u.user_id = uc.user_id
        WHERE uc.class_id = $1;
    `;
    const result = await db.query(employeesQuery, [classId]);
    return result.rows;
}

async function fetchStudentsByClass(db, classId) {
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

// Function to update or insert category_scores
async function updateCategoryScores(student_id, class_id, subject_id, category, total_score, organization_id, db) {
    // Insert or update category score in a single query
    await db.query(
        `INSERT INTO category_scores (student_id, class_id, subject_id, category, total_score, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, class_id, subject_id, category, organization_id)
         DO UPDATE SET total_score = EXCLUDED.total_score`,
        [student_id, class_id, subject_id, category, total_score, organization_id]
    );
}

function generateLastFiveDates() {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 5; i++) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
    }
    return dates.reverse();
}

function generateAllDatesFromStart(termStartDate) {
    const dates = [];
    const currentDate = new Date(termStartDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to midnight to avoid any time discrepancies

    while (currentDate <= today) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

function calculateGrade(percentage) {
    if (percentage >= 90) return 'A';
    if (percentage >= 80) return 'B';
    if (percentage >= 70) return 'C';
    if (percentage >= 60) return 'D';
    return 'F';
}

function getOrdinalSuffix(i) {
    const j = i % 10,
          k = i % 100;
    if (j == 1 && k != 11) return "st";
    if (j == 2 && k != 12) return "nd";
    if (j == 3 && k != 13) return "rd";
    return "th";
}

const commonController = {
    deleteTerm: async (req, res, db) => {
        const { term_id } = req.body;
        if (!term_id) {
            return res.status(400).json({ success: false, message: 'Term ID is required.' });
        }
        try {
            await db.query('DELETE FROM terms WHERE term_id = $1 AND organization_id = $2', [term_id, req.session.organizationId]);
            res.json({ success: true, message: 'Term deleted successfully.' });
        } catch (error) {
            console.error('Error deleting term:', error);
            res.status(500).json({ success: false, message: 'Failed to delete term.', error: error.message });
        }
    },

    // Add title to all view renders
    orgDashboard: async (req, res, db) => {
        try {
            const organizationId = req.session.organizationId;

            // Fetch the current school year and term
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

                // Find the current term
                currentTerm = schoolYearResult.rows.find(row => row.current);
            }

            // If both school year and current term exist, redirect to the URL with schoolYearId and termId
            if (schoolYear && currentTerm) {
                return res.redirect(`/common/orgDashboard/schoolYearId/${schoolYear.id}/termId/${currentTerm.term_id}`);
            }

            // Otherwise, render the orgDashboard without school year/term
            res.render('common/orgDashboard', {
                title: 'Organization Dashboard',
                schoolYear,
                currentTerm,
                classes: [],
                events: [],
                announcements: [],
                organizationId,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            req.flash('error', 'Failed to load dashboard data.');
            res.redirect('/');
        }
    },

    // Org Dashboard with specific School Year and Term
    orgDashboardRestricted: async (req, res, db) => {
        try {
            const organizationId = req.session.organizationId;
            const { schoolYearId, termId } = req.params;

            // Fetch data for the specific school year and term
            const schoolYearResult = await db.query(`
                SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.id = $1 AND t.term_id = $2 AND sy.organization_id = $3
            `, [schoolYearId, termId, organizationId]);

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

                // Find the current term based on termId
                currentTerm = schoolYearResult.rows.find(row => row.term_id == termId);
            }

            // If schoolYear or currentTerm is invalid, redirect to general dashboard
            if (!schoolYear || !currentTerm) {
                req.flash('error', 'Invalid school year or term.');
                return res.redirect('/common/orgDashboard');
            }

            // Fetch related classes, events, and announcements for the given school year/term
            const classes = await getClassesWithEmployees(db, organizationId);
            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date', [organizationId]);
            const events = eventsResult.rows.filter(event => event.school_year_id == schoolYearId);

            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 ORDER BY announcement_id DESC', [organizationId]);
            const announcements = announcementsResult.rows.filter(announcement => announcement.school_year_id == schoolYearId);

            // Render the orgDashboard with schoolYear and term context
            res.render('common/orgDashboard', {
                title: 'Organization Dashboard',
                schoolYear,
                currentTerm,
                classes,
                events,
                announcements,
                organizationId,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            req.flash('error', 'Failed to load dashboard data.');
            res.redirect('/');
        }
    },
    
// Org Dashboard with specific School Year and Term
orgDashboardRestricted: async (req, res, db) => {
    try {
        const organizationId = req.session.organizationId;
        const { schoolYearId, termId } = req.params;

        // Fetch data for the specific school year and term
        const schoolYearResult = await db.query(`
            SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
            FROM school_years sy
            LEFT JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.id = $1 AND t.term_id = $2 AND sy.organization_id = $3
        `, [schoolYearId, termId, organizationId]);

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

            // Find the current term based on termId
            currentTerm = schoolYearResult.rows.find(row => row.term_id == termId);
        }

        // If schoolYear or currentTerm is invalid, redirect to general dashboard
        if (!schoolYear || !currentTerm) {
            req.flash('error', 'Invalid school year or term.');
            return res.redirect('/common/orgDashboard');
        }

        // Fetch classes assigned to this term and their employees
        const classesResult = await db.query(`
            SELECT c.class_id, c.class_name,
                json_agg(
                    json_build_object(
                        'user_id', u.user_id,
                        'name', u.first_name || ' ' || u.last_name,
                        'main', uc.main,
                        'on_hold', u.on_hold
                    ) ORDER BY u.user_id
                ) AS employees
            FROM classes c
            INNER JOIN term_classes tc ON c.class_id = tc.class_id
            LEFT JOIN user_classes uc ON c.class_id = uc.class_id
            LEFT JOIN users u ON u.user_id = uc.user_id
            WHERE tc.term_id = $1 AND tc.organization_id = $2
            GROUP BY c.class_id
        `, [termId, organizationId]);

        const classes = classesResult.rows;

        // Fetch events and announcements
        const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date', [organizationId]);
        const events = eventsResult.rows.filter(event => event.school_year_id == schoolYearId);

        const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 ORDER BY announcement_id DESC', [organizationId]);
        const announcements = announcementsResult.rows.filter(announcement => announcement.school_year_id == schoolYearId);

        // Render the orgDashboard with schoolYear and term context
        res.render('common/orgDashboard', {
            title: 'Organization Dashboard',
            schoolYear,
            currentTerm,
            classes, // Now filtered by the term and includes employees
            events,
            announcements,
            organizationId,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        req.flash('error', 'Failed to load dashboard data.');
        res.redirect('/');
    }
},

    
    addStudentGet: async (req, res, db) => {
        try {
            const classQuery = `
                SELECT c.class_id, c.class_name
                FROM classes c
                WHERE c.organization_id = $1
                ORDER BY c.class_name ASC;
            `;
            const classResult = await db.query(classQuery, [req.session.organizationId]);
    
            const graduationYearGroupQuery = `
                SELECT id, name
                FROM graduation_year_groups
                WHERE organization_id = $1
                ORDER BY name ASC;
            `;
            const graduationYearGroupResult = await db.query(graduationYearGroupQuery, [req.session.organizationId]);
    
            const subjectQuery = `
                SELECT s.subject_id, s.subject_name
                FROM subjects s
                WHERE s.organization_id = $1
                ORDER BY s.subject_name ASC;
            `;
            const subjectResult = await db.query(subjectQuery, [req.session.organizationId]);
    
            res.render('common/addStudent', {
                title: 'Add New Student',
                classes: classResult.rows,
                graduationYearGroups: graduationYearGroupResult.rows,
                subjects: subjectResult.rows,
                messages: req.flash()
            });
        } catch (err) {
            console.error('Error fetching data for add student:', err);
            res.status(500).send('Error fetching data for add student');
        }
    },    

    addStudentPost: async (req, res, db) => {
        const { firstName, lastName, dateOfBirth, height, hometown, classId, graduationYearGroupId, guardians, subjects, gender } = req.body;
        let studentImageUrl = 'profilePlaceholder.png';

        if (req.file) {
            studentImageUrl = await uploadToS3(req.file);
        }

        const organizationId = req.session.organizationId;

        if (!firstName || !lastName || !classId || !dateOfBirth || !graduationYearGroupId || !gender) {
            req.flash('error', 'First name, last name, class, date of birth, graduation year group, and gender are required.');
            return res.redirect('/common/addStudent');
        }

        try {
            const result = await db.query(
                'INSERT INTO students (first_name, last_name, date_of_birth, height, hometown, class_id, image_url, graduation_year_group_id, gender, created_by, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING student_id',
                [firstName, lastName, dateOfBirth, height, hometown, classId, studentImageUrl, graduationYearGroupId, gender, req.session.userId, organizationId]
            );
            const studentId = result.rows[0].student_id;

            if (Array.isArray(guardians)) {
                for (const guardian of guardians) {
                    await db.query(
                        'INSERT INTO guardians (first_name, last_name, address, phone, hometown, student_id, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                        [guardian.firstName, guardian.lastName, guardian.address, guardian.phone, guardian.hometown, studentId, organizationId]
                    );
                }
            }

            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query(
                        'INSERT INTO student_subjects (student_id, subject_id, organization_id) VALUES ($1, $2, $3)',
                        [studentId, subjectId, organizationId]
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
    },
    
    getMajorityGraduationYearGroup: async (req, res, db) => {
        const { classId } = req.query;

        if (!classId) {
            return res.status(400).json({ error: 'Class ID is required.' });
        }

        try {
            const result = await db.query(`
                SELECT graduation_year_group_id, COUNT(*) as count
                FROM students
                WHERE class_id = $1 AND organization_id = $2
                GROUP BY graduation_year_group_id
                ORDER BY count DESC
                LIMIT 1;
            `, [classId, req.session.organizationId]);

            if (result.rows.length > 0) {
                res.json({ majorityGraduationYearGroupId: result.rows[0].graduation_year_group_id });
            } else {
                res.json({ majorityGraduationYearGroupId: null });
            }
        } catch (err) {
            console.error('Error fetching majority graduation year group:', err);
            res.status(500).json({ error: 'Failed to fetch majority graduation year group.' });
        }
    },

    getSubjectsForClass: async (req, res, db) => {
        const { classId } = req.query;

        if (!classId) {
            return res.status(400).json({ error: 'Class ID is required.' });
        }

        try {
            const subjectsResult = await db.query(`
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
                ORDER BY subject_name ASC;
            `, [classId, req.session.organizationId]);

            res.json(subjectsResult.rows);
        } catch (err) {
            console.error('Error fetching subjects:', err);
            res.status(500).json({ error: 'Failed to load subjects.' });
        }
    },

    studentDetails: async (req, res, db) => {
        const studentId = req.query.studentId;
    
        if (!studentId) {
            return res.status(400).send('Student ID is required.');
        }
    
        try {
            // Fetch student details
            const studentResult = await db.query(`
                SELECT s.*, c.class_name, g.name AS grad_year_group_name
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
                WHERE s.student_id = $1 AND s.organization_id = $2
            `, [studentId, req.session.organizationId]);
    
            if (studentResult.rows.length === 0) {
                return res.status(404).send('Student not found.');
            }
    
            const student = studentResult.rows[0];
    
            // Fetch guardians associated with the student
            const guardiansResult = await db.query(`
                SELECT * FROM guardians
                WHERE student_id = $1
            `, [studentId]);
    
            // Fetch all subjects for the student's class
            const subjectsResult = await db.query(`
                SELECT s.subject_id, s.subject_name
                FROM subjects s
                LEFT JOIN student_subjects ss ON s.subject_id = ss.subject_id
                WHERE ss.student_id = $1 AND s.organization_id = $2
                ORDER BY s.subject_name
            `, [studentId, req.session.organizationId]);
    
            const subjects = subjectsResult.rows.map(subject => ({
                ...subject,
                totalScore: 0,
                totalMaxScore: 0,
                totalPercentage: null,
                grade: null,
                position: null,
                assessments: []
            }));
    
            // Fetch assessments and scores for the student
            const assessmentsResult = await db.query(`
                SELECT a.assessment_id, a.title, a.weight, ar.score, a.subject_id, a.max_score, a.category,
                       ar.total_subject_score, ar.total_percentage, ar.grade
                FROM assessments a
                LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
                WHERE a.subject_id IN (SELECT subject_id FROM student_subjects WHERE student_id = $1)
                AND a.organization_id = $2
                ORDER BY a.subject_id, a.assessment_id
            `, [studentId, req.session.organizationId]);
    
            // Aggregate assessments by subject
            assessmentsResult.rows.forEach(assessment => {
                const subject = subjects.find(sub => sub.subject_id === assessment.subject_id);
                if (subject) {
                    subject.assessments.push(assessment);
                    if (assessment.score !== null) {
                        subject.totalScore += parseFloat(assessment.score);
                        subject.totalMaxScore += parseFloat(assessment.max_score);
                    }
                    if (assessment.total_percentage !== null) {
                        subject.totalPercentage = parseFloat(assessment.total_percentage);
                    }
                    if (assessment.grade) {
                        subject.grade = assessment.grade;
                    }
                }
            });
    
            // Fetch positions from student_positions table
            const positionsResult = await db.query(`
                SELECT subject_id, position
                FROM student_positions
                WHERE student_id = $1 AND organization_id = $2
            `, [studentId, req.session.organizationId]);
    
            const positions = positionsResult.rows.reduce((acc, position) => {
                acc[position.subject_id] = position.position;
                return acc;
            }, {});
    
            subjects.forEach(subject => {
                subject.position = positions[subject.subject_id] || '-';
            });
    
            const guardians = guardiansResult.rows;
    
            res.render('common/studentDetails', {
                title: 'Student Details',
                student,
                guardians,
                subjects,
                getOrdinalSuffix, // Passing the function to the template
                gradYearGroupName: student.grad_year_group_name || 'No graduation year group assigned',
                messages: req.flash()
            });
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Failed to fetch student details');
        }
    },
    
    editStudentGet: async (req, res, db) => {
        const studentId = req.query.studentId;
    
        if (!studentId) {
            req.flash('error', 'Student ID is required.');
            return res.redirect('/common/manageRecords'); // Redirect to an appropriate page
        }
    
        try {
            // Fetch student details
            const studentResult = await db.query(`
                SELECT s.*, c.class_name, g.name AS grad_year_group_name
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
                WHERE s.student_id = $1 AND s.organization_id = $2
            `, [studentId, req.session.organizationId]);
    
            if (studentResult.rows.length === 0) {
                req.flash('error', 'Student not found.');
                return res.redirect('/common/manageRecords');
            }
    
            const student = studentResult.rows[0];
    
            // Fetch all classes and graduation year groups to populate dropdowns in the edit form
            const classResult = await db.query('SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);
            const graduationYearGroupResult = await db.query('SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name ASC', [req.session.organizationId]);
    
            // Fetch guardians associated with the student
            const guardiansResult = await db.query('SELECT * FROM guardians WHERE student_id = $1 AND organization_id = $2', [studentId, req.session.organizationId]);
    
            // Fetch subjects available for the student's class
            const subjectResult = await db.query(`
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
                ORDER BY subject_name ASC
            `, [student.class_id, req.session.organizationId]);
    
            // Fetch subjects the student is enrolled in
            const enrolledSubjectsResult = await db.query(`
                SELECT subject_id
                FROM student_subjects
                WHERE student_id = $1 AND organization_id = $2
            `, [studentId, req.session.organizationId]);
    
            const subjects = subjectResult.rows;
            const enrolledSubjects = enrolledSubjectsResult.rows.map(row => row.subject_id);
    
            res.render('common/editStudent', {
                title: 'Edit Student Details',
                student,
                classes: classResult.rows,
                graduationYearGroups: graduationYearGroupResult.rows,
                guardians: guardiansResult.rows,
                subjects: subjects, // Pass the subjects to the template
                enrolledSubjects: enrolledSubjects, // Pass the enrolled subjects to the template
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching student details:', error);
            req.flash('error', 'Failed to load student details.');
            res.redirect('/common/manageRecords');
        }
    },
                    
    editStudentPost: async (req, res, db) => {
        const { studentId } = req.params;
        const { classId, firstName, lastName, dateOfBirth, height, hometown, gender, subjects = [], graduationYearGroupId, guardians } = req.body;
        const file = req.file;

        try {
            let imageUrl = null;
            if (file) {
                imageUrl = await uploadToS3(file);

                const studentResult = await db.query('SELECT image_url FROM students WHERE student_id = $1', [studentId]);
                const student = studentResult.rows[0];
                const oldImageUrl = student.image_url;

                if (oldImageUrl && oldImageUrl !== 'profilePlaceholder.png') {
                    const oldImageKey = path.basename(oldImageUrl); 
                    await deleteFromS3(`images/${oldImageKey}`);
                }
            }

            await db.query(
                `UPDATE students SET class_id = $1, first_name = $2, last_name = $3, date_of_birth = $4, height = $5, hometown = $6, gender = $7, image_url = $8, graduation_year_group_id = $9 WHERE student_id = $10 AND organization_id = $11`,
                [classId, firstName, lastName, dateOfBirth, height, hometown, gender, imageUrl, graduationYearGroupId, studentId, req.session.organizationId]
            );

            await db.query('DELETE FROM student_subjects WHERE student_id = $1', [studentId]);

            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query('INSERT INTO student_subjects (student_id, subject_id) VALUES ($1, $2)', [studentId, subjectId]);
                }
            }

            await db.query('DELETE FROM guardians WHERE student_id = $1', [studentId]);

            if (Array.isArray(guardians)) {
                for (const guardian of guardians) {
                    if (guardian.firstName && guardian.lastName) {
                        await db.query(
                            'INSERT INTO guardians (first_name, last_name, address, phone, hometown, student_id) VALUES ($1, $2, $3, $4, $5, $6)',
                            [guardian.firstName, guardian.lastName, guardian.address, guardian.phone, guardian.hometown, studentId]
                        );
                    }
                }
            }

            req.flash('success', 'Student details updated successfully.');
            res.redirect(`/common/studentDetails?studentId=${studentId}`);
        } catch (error) {
            console.error('Error updating student details:', error);
            req.flash('error', 'Failed to update student details.');
            res.redirect(`/common/editStudent?studentId=${studentId}`);
        }
    },

    deleteStudentImage: async (req, res, db) => {
        const { studentId } = req.params;

        try {
            const studentResult = await db.query('SELECT image_url FROM students WHERE student_id = $1', [studentId]);
            const student = studentResult.rows[0];
            const imageUrl = student.image_url;

            if (imageUrl && imageUrl !== 'profilePlaceholder.png') {
                const imageKey = path.basename(imageUrl); 
                await deleteFromS3(`images/${imageKey}`);

                await db.query('UPDATE students SET image_url = $1 WHERE student_id = $2', ['profilePlaceholder.png', studentId]);

                req.flash('success', 'Image deleted successfully.');
                res.redirect(`/common/editStudent?studentId=${studentId}`);
            } else {
                req.flash('error', 'No image to delete.');
                res.redirect(`/common/editStudent?studentId=${studentId}`);
            }
        } catch (error) {
            console.error('Error deleting student image:', error);
            req.flash('error', 'Failed to delete student image.');
            res.redirect(`/common/editStudent?studentId=${studentId}`);
        }
    },       

    deleteStudent: async (req, res, db) => {
        const { studentId } = req.params;
    
        if (!studentId) {
            req.flash('error', 'Student ID is required.');
            return res.redirect(`/common/editStudent?studentId=${studentId}`);
        }
    
        try {
            // Fetch the student's image URL and class ID
            const student = await db.query('SELECT image_url, class_id FROM students WHERE student_id = $1', [studentId]);
            
            if (student.rows.length > 0) {
                const imageUrl = student.rows[0].image_url;
                const classId = student.rows[0].class_id;
    
                if (imageUrl && imageUrl !== 'profilePlaceholder.png') {
                    const imageKey = path.basename(imageUrl); 
                    await deleteFromS3(`images/${imageKey}`);
                }
    
                // Delete the student's associated data
                await db.query('DELETE FROM guardians WHERE student_id = $1', [studentId]);
                await db.query('DELETE FROM student_subjects WHERE student_id = $1', [studentId]);
                await db.query('DELETE FROM students WHERE student_id = $1 AND organization_id = $2', [studentId, req.session.organizationId]);
    
                req.flash('success', 'Student deleted successfully.');
                res.redirect(`/common/classDashboard?classId=${classId}`);
            } else {
                req.flash('error', 'Student not found.');
                res.redirect(`/common/editStudent?studentId=${studentId}`);
            }
        } catch (error) {
            console.error('Error deleting student:', error);
            req.flash('error', 'Failed to delete student.');
            res.redirect(`/common/editStudent?studentId=${studentId}`);
        }
    },
                        
    getAttendanceForClass: async (req, res, db) => {
        const { classId } = req.query;

        try {
            const result = await db.query('SELECT * FROM attendance_records WHERE class_id = $1', [classId]);
            res.json({ success: true, attendance: result.rows });
        } catch (error) {
            console.error('Error fetching attendance:', error);
            res.json({ success: false, error: error.message });
        }
    },

    attendance: async (req, res, db) => {
        const { classId } = req.query;
        try {
            const classResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            if (classResult.rows.length === 0) {
                return res.status(404).send('Class not found');
            }
            const className = classResult.rows[0].class_name;
    
            const termDatesResult = await db.query(`
                SELECT DISTINCT t.start_date, t.end_date
                FROM terms t
                JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE tc.class_id = $1
                ORDER BY t.start_date DESC`, [classId]);
    
            const dates = [];
            termDatesResult.rows.forEach(row => {
                let currentDate = new Date(row.start_date);
                const endDate = new Date(row.end_date);
                const today = new Date().toISOString().split('T')[0];
    
                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    if (dateStr <= today) {
                        dates.push(dateStr);
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
    
            const displayDates = dates.sort((a, b) => new Date(b) - new Date(a)).slice(0, 5).reverse();
            const students = await fetchStudentsByClass(db, classId);
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
                title: 'Attendance Records',
                classId,
                className,
                displayDates,
                students,
                attendanceMap,
                today: new Date().toISOString().split('T')[0] // Pass current date
            });
        } catch (error) {
            console.error('Error fetching attendance data:', error);
            res.status(500).send('Error loading attendance records page');
        }
    },

    attendanceCollection: async (req, res, db) => {
        const { classId } = req.query;
        try {
            const classResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            if (classResult.rows.length === 0) {
                return res.status(404).send('Class not found');
            }
            const className = classResult.rows[0].class_name;
    
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
                const today = new Date().toISOString().split('T')[0];
    
                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    if (dateStr <= today) {
                        dates.push(dateStr);
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
    
            const displayDates = dates.sort((a, b) => new Date(b) - new Date(a)); // Corrected sorting
            const students = await fetchStudentsByClass(db, classId);
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
    
            res.render('common/attendanceCollection', {
                title: 'Attendance Records',
                classId,
                className,
                displayDates,
                students,
                attendanceMap,
                today: new Date().toISOString().split('T')[0] // Pass current date
            });
        } catch (error) {
            console.error('Error fetching attendance data:', error);
            res.status(500).send('Error loading attendance records page');
        }
    },
    
    saveSingleAttendance: async (req, res, db) => {
        const { attendance, classId, date } = req.body;

    try {
        await db.query('BEGIN');
        
        for (const studentId in attendance) {
            const status = attendance[studentId];
            
            await db.query(`
                INSERT INTO attendance_records (student_id, date, status, class_id, marked_by, organization_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (student_id, date)
                DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by
            `, [studentId, date, status, classId, req.session.userId, req.session.organizationId]);
        }
        
        await db.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error saving attendance:', error); // Log for debugging
        res.status(500).json({ success: false, message: 'Failed to save attendance' });
    }
    },

    createEmployeeGet: async (req, res, db) => {
        try {
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);
            res.render('common/createEmployee', {
                title: 'Create Employee',
                classes: classesResult.rows,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        } catch (error) {
            console.error('Error fetching classes:', error);
            req.flash('error', 'Failed to load classes.');
            res.redirect('/common/manageEmployees');
        }
      },

      createEmployeePost: async (req, res, db) => {
        const { firstName, lastName, email, password, account_type, classes, subjects } = req.body;
    
        if (!firstName || !lastName || !email || !password || !account_type) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/common/createEmployee');
        }
    
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const result = await db.query(
                `INSERT INTO users (first_name, last_name, email, password, account_type, organization_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING user_id`, 
                [firstName, lastName, email, hashedPassword, account_type, req.session.organizationId]
            );
    
            const userId = result.rows[0].user_id;
    
            if (Array.isArray(classes)) {
                for (const classId of classes) {
                    await db.query('INSERT INTO user_classes (user_id, class_id) VALUES ($1, $2)', [userId, classId]);
                }
            }
    
            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query('INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2)', [userId, subjectId]);
                }
            }
    
            req.flash('success', 'Employee created successfully.');
            res.redirect('/common/createEmployee');
        } catch (error) {
            console.error('Error creating employee:', error);
            req.flash('error', 'Failed to create employee.');
            res.redirect('/common/createEmployee');
        }
    },

    manageEmployees: async (req, res, db) => {
        try {
            const result = await db.query(`
                SELECT u.*, array_agg(uc.class_id) as class_ids
                FROM users u
                LEFT JOIN user_classes uc ON u.user_id = uc.user_id
                WHERE u.organization_id = $1
                GROUP BY u.user_id
                ORDER BY u.first_name, u.last_name`, [req.session.organizationId]);

            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);

            const employees = result.rows;
            for (let employee of employees) {
                const classIds = employee.class_ids || [];
                employee.classes = await db.query('SELECT class_name FROM classes WHERE class_id = ANY($1)', [classIds]).then(res => res.rows);
                
                const subjects = await db.query('SELECT sub.subject_name FROM subjects sub JOIN user_subjects us ON sub.subject_id = us.subject_id WHERE us.user_id = $1', [employee.user_id]);
                employee.subjects = subjects.rows;
            }

            res.render('common/manageEmployees', {
                title: 'Manage Employees',
                employees: employees,
                classes: classesResult.rows,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        } catch (error) {
            console.error('Error fetching employees:', error);
            req.flash('error', 'Failed to load employees.');
            res.redirect('/common/createEmployee');
        }
    },

    toggleHoldEmployee: async (req, res, db) => {
        const { userId } = req.params;
        try {
            const result = await db.query('UPDATE users SET on_hold = NOT on_hold WHERE user_id = $1 AND organization_id = $2 RETURNING on_hold', [userId, req.session.organizationId]);
            const newStatus = result.rows[0].on_hold ? 'on hold' : 'resumed';
            req.flash('success', `Employee has been ${newStatus}.`);
            res.redirect(`/common/modifyEmployee?userId=${userId}`);
        } catch (error) {
            console.error('Error toggling hold status:', error);
            req.flash('error', 'Failed to update employee status.');
            res.redirect(`/common/modifyEmployee?userId=${userId}`);
        }
    },
    
    modifyEmployeeGet: async (req, res, db) => {
        const { userId } = req.query;

        if (!userId) {
            res.status(400).send('User ID is required.');
            return;
        }

        try {
            const userResult = await db.query('SELECT * FROM users WHERE user_id = $1 AND organization_id = $2', [userId, req.session.organizationId]);
            if (userResult.rows.length === 0) {
                res.status(404).send('User not found.');
                return;
            }
            const user = userResult.rows[0];

            const classesResult = await db.query(`
                SELECT c.class_id, c.class_name
                FROM classes c
                WHERE c.organization_id = $1
                ORDER BY c.class_name ASC`, [req.session.organizationId]);

            const subjectsResult = await db.query(`
                SELECT s.subject_id, s.subject_name, s.class_id
                FROM subjects s
                WHERE s.organization_id = $1`, [req.session.organizationId]);

            const classMap = classesResult.rows.reduce((map, cls) => {
                map[cls.class_id] = { ...cls, subjects: [] };
                return map;
            }, {});

            subjectsResult.rows.forEach(subject => {
                if (classMap[subject.class_id]) {
                    classMap[subject.class_id].subjects.push(subject);
                }
            });

            const classes = Object.values(classMap);

            const enrolledSubjectsResult = await db.query(`
                SELECT us.subject_id
                FROM user_subjects us
                WHERE us.user_id = $1`, [userId]);
            const enrolledSubjects = enrolledSubjectsResult.rows.map(subject => subject.subject_id);

            const employeeClassesResult = await db.query(`
                SELECT class_id
                FROM user_classes
                WHERE user_id = $1`, [userId]);
            const enrolledClasses = employeeClassesResult.rows.map(cls => cls.class_id);

            res.render('common/modifyEmployee', {
                title: 'Modify Employee',
                user,
                classes,
                enrolledClasses,
                enrolledSubjects,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error loading modify employee page:', error);
            res.status(500).send('Failed to load employee details.');
        }
    },

    modifyEmployeePost: async (req, res, db) => {
        const { userId } = req.params;
        const { firstName, lastName, email, accountType, classIds = [], subjects = [] } = req.body;

        try {
            await db.query(
                `UPDATE users
                 SET first_name = $1, last_name = $2, email = $3, account_type = $4, updated_at = NOW()
                 WHERE user_id = $5 AND organization_id = $6`, [firstName, lastName, email, accountType, userId, req.session.organizationId]);

            await db.query('DELETE FROM user_classes WHERE user_id = $1', [userId]);
            if (Array.isArray(classIds)) {
                for (const classId of classIds) {
                    await db.query('INSERT INTO user_classes (user_id, class_id) VALUES ($1, $2)', [userId, classId]);
                }
            }

            await db.query('DELETE FROM user_subjects WHERE user_id = $1', [userId]);
            if (Array.isArray(subjects)) {
                for (const subjectId of subjects) {
                    await db.query('INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2)', [userId, subjectId]);
                }
            }

            req.flash('success', 'Employee details updated successfully.');
            res.redirect('/common/manageEmployees');
        } catch (error) {
            console.error('Error updating employee details:', error);
            req.flash('error', 'Failed to update employee details.');
            res.redirect(`/common/modifyEmployee?userId=${userId}`);
        }
    },


    assessment: async (req, res, db) => {
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
    
            // Fetch all classes for the organization
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);
            const classes = classesResult.rows;
    
            // Fetch all subjects for the organization
            const subjectsResult = await db.query('SELECT * FROM subjects WHERE organization_id = $1', [req.session.organizationId]);
            const subjects = subjectsResult.rows;
    
            // Fetch students in the class, ordered by last name and first name
            let students = await db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 AND organization_id = $2 ORDER BY last_name ASC, first_name ASC', [classId, req.session.organizationId]);
    
            // Fetch assessments for the subject, including the category
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, max_score, category
                FROM assessments
                WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3
                ORDER BY assessment_id`, [classId, subjectId, req.session.organizationId]);
            const assessments = assessmentsResult.rows;
    
            // Fetch scores and positions for the students in this subject
            const resultsResult = await db.query(`
                SELECT ar.assessment_id, ar.student_id, ar.score, ar.total_subject_score, ar.total_percentage, ar.grade,
                       sp.position
                FROM assessment_results ar
                LEFT JOIN student_positions sp
                ON ar.student_id = sp.student_id AND ar.subject_id = sp.subject_id
                WHERE ar.assessment_id IN (
                    SELECT assessment_id
                    FROM assessments
                    WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3
                )
                AND ar.student_id IN (
                    SELECT student_id
                    FROM students
                    WHERE class_id = $1
                )
                ORDER BY ar.student_id, ar.assessment_id`, [classId, subjectId, req.session.organizationId]);
    
            const results = resultsResult.rows;
    
            // Organize the scores by student and populate total scores and other details
            const studentScores = {};
            results.forEach(result => {
                if (!studentScores[result.student_id]) {
                    studentScores[result.student_id] = {
                        assessments: {},
                        total_subject_score: result.total_subject_score,
                        total_percentage: result.total_percentage,
                        grade: result.grade,
                        position: result.position, // Added position from student_positions table
                    };
                }
                studentScores[result.student_id].assessments[result.assessment_id] = result.score;
            });
    
            students.rows.forEach(student => {
                student.scores = studentScores[student.student_id] ? studentScores[student.student_id].assessments : {};
                student.total_subject_score = studentScores[student.student_id] ? studentScores[student.student_id].total_subject_score : '-';
                student.total_percentage = studentScores[student.student_id] ? studentScores[student.student_id].total_percentage : '-';
                student.grade = studentScores[student.student_id] ? studentScores[student.student_id].grade : '-';
                student.position = studentScores[student.student_id] ? studentScores[student.student_id].position : '-';
            });
    
            // Fetch employees assigned to the class
            const employeesResult = await db.query(`
                SELECT u.first_name, u.last_name, uc.main
                FROM user_classes uc
                JOIN users u ON uc.user_id = u.user_id
                WHERE uc.class_id = $1 AND u.organization_id = $2`, [classId, req.session.organizationId]);
            const employees = employeesResult.rows;
    
            // Render the assessment page and pass classes and subjects
            res.render('common/assessment', {
                title: 'Assessment',
                classId,
                className,
                subjectId,
                subjectName,
                assessments,
                students: students.rows,
                employees, // Pass the employees to the template
                classes, // Pass classes to the template
                subjects, // Pass subjects to the template
                messages: req.flash() // Pass messages to the template
            });
        } catch (err) {
            console.error('Error fetching assessment data:', err);
            res.status(500).send('Error fetching assessment data.');
        }
    },
            
    saveAllScores: async (req, res, db) => {
        const { subjectId, classId } = req.query;
        const { scores } = req.body;
    
        try {
            // Fetch assessments related to this subject and class, including categories
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, max_score, category
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3
                ORDER BY assessment_id`, [subjectId, classId, req.session.organizationId]);
    
            const assessments = assessmentsResult.rows;
    
            await db.query('BEGIN');
    
            // Store total category scores and subject scores for students
            const studentCategoryScores = {};
            const studentTotalScores = {};
    
            // Process each student's scores
            for (let studentId in scores) {
                // Reset total category scores and total subject scores for the student
                studentCategoryScores[studentId] = {};
                studentTotalScores[studentId] = 0;
    
                for (let assessmentId in scores[studentId]) {
                    let score = scores[studentId][assessmentId];
                    if (score === null || score === "") continue;
    
                    // Fetch the related assessment details
                    const assessment = assessments.find(a => a.assessment_id == assessmentId);
                    if (!assessment) continue;
    
                    const { category } = assessment;
    
                    // Sum scores by category
                    if (!studentCategoryScores[studentId][category]) {
                        studentCategoryScores[studentId][category] = 0;
                    }
                    studentCategoryScores[studentId][category] += parseFloat(score);
    
                    // Sum the total score for the student across all assessments
                    studentTotalScores[studentId] += parseFloat(score);
    
                    // Insert or update the score in the assessment_results table
                    await db.query(`
                        INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, organization_id, class_id, category)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (student_id, assessment_id)
                        DO UPDATE SET score = EXCLUDED.score, category = EXCLUDED.category`,
                        [studentId, assessmentId, score, subjectId, req.session.organizationId, classId, category]);
                }
            }
            // Update total category score for each student in the assessment_results table
            for (let studentId in studentCategoryScores) {
                for (let category in studentCategoryScores[studentId]) {
                    const totalCategoryScore = studentCategoryScores[studentId][category];
    
                    // Update the total_category_score for each category in the assessment_results table
                    await db.query(`
                        UPDATE assessment_results
                        SET total_category_score = $1
                        WHERE student_id = $2 AND subject_id = $3 AND class_id = $4 AND category = $5 AND organization_id = $6`,
                        [totalCategoryScore, studentId, subjectId, classId, category, req.session.organizationId]);
    
                    // Update or Insert into category_scores table
                    await updateCategoryScores(studentId, classId, subjectId, category, totalCategoryScore, req.session.organizationId, db);
                }
            }
    
            // Now update the total subject score, percentage, and grade for each student
            for (let studentId in studentTotalScores) {
                const totalScore = studentTotalScores[studentId];
    
                // Calculate the total percentage based on the weight of the assessments
                const totalPercentage = commonController.calculateTotalPercentage(scores[studentId], assessments);
                const grade = commonController.calculateGrade(totalPercentage);
    
                const validTotalPercentage = totalPercentage !== "-" ? totalPercentage : null;
                const validGrade = grade !== "-" ? grade : null;
    
                // Update total subject score, percentage, and grade
                await db.query(`
                    UPDATE assessment_results
                    SET total_subject_score = $1, total_percentage = $2, grade = $3
                    WHERE student_id = $4 AND subject_id = $5 AND organization_id = $6`,
                    [totalScore, validTotalPercentage, validGrade, studentId, subjectId, req.session.organizationId]);
    
                // Insert or update in the student_positions table with class_id
                await db.query(`
                    INSERT INTO student_positions (student_id, subject_id, organization_id, total_subject_score, class_id, position)
                    VALUES ($1, $2, $3, $4, $5, 0) -- Position will be updated separately
                    ON CONFLICT (student_id, subject_id)
                    DO UPDATE SET total_subject_score = EXCLUDED.total_subject_score, class_id = EXCLUDED.class_id`,
                    [studentId, subjectId, req.session.organizationId, totalScore, classId]);
            }
    
            // Update positions based on total subject scores
            await commonController.updateStudentPositions(db, subjectId, req.session.organizationId);
    
            await db.query('COMMIT');
    
            req.flash('success', 'Scores saved successfully.');
            res.status(200).json({ success: true, message: 'Scores saved successfully.' });
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error saving scores:', error);
            req.flash('error', 'An error occurred while saving scores. Please try again.');
            res.status(500).json({ error: 'An error occurred while saving scores. Please try again.' });
        }
    },
    
        updateStudentPositions: async function (db, subjectId, organizationId) {
        const updateQuery = `
        WITH RankedScores AS (
            SELECT
                student_id,
                subject_id,
                SUM(score) AS total_subject_score,
                RANK() OVER (PARTITION BY subject_id ORDER BY SUM(score) DESC) AS position
            FROM assessment_results
            WHERE subject_id = $1 AND organization_id = $2
            GROUP BY student_id, subject_id
        )
        INSERT INTO student_positions (student_id, subject_id, organization_id, total_subject_score, position)
        SELECT 
            rs.student_id,
            rs.subject_id,
            $2,
            rs.total_subject_score,
            rs.position
        FROM RankedScores rs
        ON CONFLICT (student_id, subject_id) DO UPDATE
        SET 
            total_subject_score = EXCLUDED.total_subject_score,
            position = EXCLUDED.position;
        `;

        try {
            await db.query(updateQuery, [subjectId, organizationId]);
        } catch (error) {
            console.error('Error updating student positions:', error);
            throw error;
        }
    },

calculateTotalPercentage: (scores, assessments) => {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let hasScore = false;

    assessments.forEach(assessment => {
        const score = scores ? scores[assessment.assessment_id] : null;
        let scorePercentage = 100; // Default to 100% if no score is present
        
        if (score !== null && score !== undefined) {
            hasScore = true;
            scorePercentage = (score / assessment.max_score) * 100; // Calculate the percentage score
        }

        const weightedScore = (scorePercentage / 100) * assessment.weight; // Scale by the test's weight
        totalWeightedScore += weightedScore;
        totalWeight += assessment.weight;
    });

    if (!hasScore) {
        return "-"; // No score entered for any test
    }

    const scaledTotalPercentage = totalWeight > 0 ? totalWeightedScore : "-";
    return scaledTotalPercentage;
},

calculateGrade: (totalPercentage) => {
    if (totalPercentage === "-" || isNaN(totalPercentage)) return "-";
    if (totalPercentage >= 90) return 'A';
    if (totalPercentage >= 80) return 'B';
    if (totalPercentage >= 70) return 'C';
    if (totalPercentage >= 60) return 'D';
    return 'F';
},


    getAssessments: async (req, res, db) => {
        const { classId, subjectId } = req.query;

        try {
            const result = await db.query(
                'SELECT * FROM assessments WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 ORDER BY assessment_id ASC', [classId, subjectId, req.session.organizationId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching assessments:', error);
            res.status(500).send('Failed to fetch assessments');
        }
    },

    getScores: async (req, res, db) => {
        const { classId, subjectId } = req.query;

        try {
            const result = await db.query(`
                SELECT ar.student_id, ar.assessment_id, ar.score, s.first_name, s.last_name
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3
                ORDER BY ar.assessment_id ASC, s.student_id ASC`, [classId, subjectId, req.session.organizationId]);

            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching scores:', error);
            res.status(500).send('Failed to fetch scores');
        }
    },

    manageAssessment: async (req, res, db) => {
        let { classId, subjectId } = req.query;
    
        // Validate incoming classId and subjectId
        if (!classId || !subjectId) {
            console.error("Class ID or Subject ID is missing.");
            req.flash('error', 'Class ID and Subject ID are required.');
            return res.status(400).send('Class ID and Subject ID are required.');
        }
    
        classId = parseInt(classId, 10);
        subjectId = parseInt(subjectId, 10);
    
        if (isNaN(classId) || isNaN(subjectId)) {
            console.error("Class ID or Subject ID is not a valid integer.");
            req.flash('error', 'Invalid Class ID or Subject ID.');
            return res.status(400).send('Invalid Class ID or Subject ID.');
        }
    
        try {
            // Fetch class name and subject name
            const classNameResult = await db.query(
                'SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2',
                [classId, req.session.organizationId]
            );
            const subjectNameResult = await db.query(
                'SELECT subject_name FROM subjects WHERE subject_id = $1 AND organization_id = $2',
                [subjectId, req.session.organizationId]
            );
    
            if (classNameResult.rows.length === 0 || subjectNameResult.rows.length === 0) {
                console.error("Class or Subject not found.");
                req.flash('error', 'Class or Subject not found.');
                return res.status(404).send('Class or Subject not found.');
            }
    
            // Fetch assessments with category
            const assessmentsResult = await db.query(
                'SELECT assessment_id, title, weight, max_score, category FROM assessments WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 ORDER BY assessment_id',
                [classId, subjectId, req.session.organizationId]
            );
    
            res.render('common/manageAssessment', {
                title: 'Manage Assessments',
                classId,
                className: classNameResult.rows[0].class_name,
                subjectId,
                subjectName: subjectNameResult.rows[0].subject_name,
                assessments: assessmentsResult.rows,
                messages: req.flash()
            });
        } catch (err) {
            console.error('Error fetching manage assessment data:', err);
            req.flash('error', 'Failed to load manage assessment data.');
            res.status(500).send('Error fetching manage assessment data.');
        }
    },
        
    createTest: async (req, res, db) => {
        const { testName, testWeight, maxScore, classId, subjectId, category } = req.body;
        const organizationId = req.session.organizationId;
    
        try {    
            // Insert new test without category ID
            await db.query(`
                INSERT INTO assessments (title, weight, max_score, class_id, subject_id, category, organization_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [testName, testWeight, maxScore, classId, subjectId, category, organizationId]
            );
    
            // console.log('Test creation process completed successfully.');
            req.flash('success', 'Test added successfully.');
            res.redirect(`/common/assessment?classId=${classId}&subjectId=${subjectId}`);
        } catch (error) {
            console.error('Error adding test:', error);
            req.flash('error', 'Error adding test.');
            res.redirect(`/common/assessment?classId=${classId}&subjectId=${subjectId}`);
        }
    },
                
    updateAssessments: async (req, res, db) => {
        const { classId, subjectId } = req.query;
        const { assessments } = req.body;
    
        try {
            // Begin transaction
            await db.query('BEGIN');
    
            for (let assessmentId in assessments) {
                const { title, weight, maxScore, category } = assessments[assessmentId];
    
                // Update the assessment with the new data, including the category
                const result = await db.query(`
                    UPDATE assessments
                    SET title = $1, weight = $2, max_score = $3, category = $4
                    WHERE assessment_id = $5 AND class_id = $6 AND subject_id = $7 AND organization_id = $8
                `, [title, parseFloat(weight), parseFloat(maxScore), category, assessmentId, classId, subjectId, req.session.organizationId]);
    
                if (result.rowCount === 0) {
                    console.error(`Failed to update assessment ID: ${assessmentId}`);
                }
            }
    
            // Commit the transaction
            await db.query('COMMIT');
    
            req.flash('success', 'Assessments updated successfully.');
            res.status(200).json({ success: true, message: 'Assessments updated successfully.' });
        } catch (err) {
            // Rollback the transaction in case of an error
            await db.query('ROLLBACK');
            console.error('Error updating assessments:', err);
            req.flash('error', 'Failed to update assessments.');
            res.status(500).json({ error: 'Failed to update assessments.' });
        }
    },
            
    deleteAssessment: async (req, res, db) => {
        const { assessmentId } = req.body;
        try {
            await db.query('DELETE FROM assessments WHERE assessment_id = $1 AND organization_id = $2', [assessmentId, req.session.organizationId]);
            req.flash('success', 'Assessment deleted successfully.');
            res.redirect('back');
        } catch (err) {
            console.error('Error deleting assessment:', err);
            req.flash('error', 'Failed to delete assessment.');
            res.redirect('back');
        }
    },

    deleteEmployee: async (req, res, db) => {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).send('User ID is required.');
        }

        try {
            await db.query('DELETE FROM user_classes WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM user_subjects WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM users WHERE user_id = $1 AND organization_id = $2', [userId, req.session.organizationId]);

            req.flash('success', 'Employee deleted successfully.');
            res.redirect('/common/manageEmployees');
        } catch (error) {
            console.error('Error deleting employee:', error);
            req.flash('error', 'Failed to delete employee.');
            res.redirect('/common/manageEmployees');
        }
    },

        classDashboard: async (req, res, db, csrfToken) => {
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
    
            const students = await fetchStudentsByClass(db, classId, req.session.organizationId);
            const subjectsResult = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name', [classId, req.session.organizationId]);
            const employees = await getClassEmployeesWithMain(db, classId);
    
            res.render('common/classDashboard', {
                title: 'Class Dashboard - ' + className,
                className: className,
                graduationYearGroup: graduationYearGroupName,
                students: students,
                subjects: subjectsResult.rows,
                classId: classId,
                employees: employees,
                attendanceLink: `/common/attendanceCollection?classId=${classId}`,
                messages: req.flash(),
                csrfToken: csrfToken
            });
        } catch (err) {
            console.error('Error fetching data:', err);
            res.status(500).send('Error loading class dashboard');
        }
    },
     
    setMainEmployee: async (req, res, db) => {
        const { class_id, main_employee } = req.body;
        try {
            await db.query('BEGIN');
            await db.query('UPDATE user_classes SET main = FALSE WHERE class_id = $1', [class_id]);
            await db.query('UPDATE user_classes SET main = TRUE WHERE class_id = $1 AND user_id = $2', [class_id, main_employee]);
            await db.query('COMMIT');
            res.json({ success: true, message: 'Main employee set successfully.' });
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error setting main employee:', error);
            res.status(500).json({ success: false, message: 'Failed to set main employee.' });
        }
    },  
        
    registerSchoolYear: async (req, res, db) => {
        const { schoolYear, terms } = req.body;
        try {
            // Insert the new school year into the database
            const yearResult = await db.query(
                'INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id',
                [schoolYear, req.session.organizationId]
            );
            const schoolYearId = yearResult.rows[0].id;
    
            // Loop through each term to insert into the database
            for (const term of terms) {
                const termResult = await db.query(
                    'INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id',
                    [term.termName, term.startDate, term.endDate, schoolYearId, req.session.organizationId]
                );
                const termId = termResult.rows[0].term_id;
    
                // Check if selectedClasses exists and is an array
                if (Array.isArray(term.selectedClasses)) {
                    // Insert each selected class for the term
                    for (const classId of term.selectedClasses) {
                        await db.query(
                            'INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)',
                            [termId, classId, req.session.organizationId]
                        );
                    }
                } else {
                    console.warn(`No classes selected for term ${term.termName}`);
                }
            }
    
            // Redirect to the manageRecords page upon successful insertion
            res.redirect('/common/manageRecords');
            
        } catch (error) {
            console.error('Error registering school year:', error);
            res.status(500).send('Error registering school year');
        }
    }
    ,


    registerSchoolYearGet: async (req, res, db) => { // Add this method
        try {
            // Fetch all classes for the organization
            const classesResult = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);
    
            res.render('common/registerSchoolYear', {
                title: 'Register School Year',
                classes: classesResult.rows, // Pass classes to the view
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error loading register school year page:', error);
            req.flash('error', 'Failed to load the form for registering a school year.');
            res.redirect('/common/manageRecords');
        }
    },

    getClasses: async (req, res, db) => {
        try {
            const result = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching classes:', error);
            res.status(500).json({ error: 'Failed to load classes.' });
        }
    },

    registerSchoolYearEvent: async (req, res, db) => {
        try {
            await db.query('INSERT INTO school_events (name, event_date, details, organization_id, visibility) VALUES ($1, $2, $3, $4, $5)', [req.body.eventName, req.body.startDate, req.body.eventDetails, req.session.organizationId, req.body.visibility]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error adding event:', error);
            res.status(500).send('Error processing your request');
        }
    },

    registerSchoolYearAnnouncement: async (req, res, db) => {
        try {
            await db.query('INSERT INTO announcements (message, organization_id, visibility) VALUES ($1, $2, $3)', [req.body.announcement, req.session.organizationId, req.body.visibility]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error posting announcement:', error);
            res.status(500).send('Error processing your request');
        }
    },

    getSchoolYearsData: async (db, organizationId) => {
        const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
        const schoolYears = schoolYearsResult.rows;

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
    },

    manageRecords: async (req, res, db) => {
        try {
            const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1', [req.session.organizationId]);
            const termsResult = await db.query(`
                SELECT t.*, array_agg(tc.class_id) AS class_ids
                FROM terms t
                LEFT JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE t.organization_id = $1
                GROUP BY t.term_id
            `, [req.session.organizationId]);
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [req.session.organizationId]);
            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1', [req.session.organizationId]);
            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1', [req.session.organizationId]);
    
            // Attach classes to each term and map them to school years
            const schoolYears = schoolYearsResult.rows.map(schoolYear => {
                const terms = termsResult.rows
                    .filter(term => term.school_year_id === schoolYear.id)
                    .map(term => ({
                        ...term,
                        class_ids: term.class_ids || [] // Ensure class_ids is present and defaults to an empty array if none
                    }));
                return { ...schoolYear, terms };
            });
    
            res.render('common/manageRecords', {
                title: 'Manage Records',
                schoolYears,
                classes: classesResult.rows, // All classes to display for selection
                events: eventsResult.rows,
                announcements: announcementsResult.rows,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        } catch (error) {
            console.error('Error fetching data:', error);
            res.status(500).send('Error loading manage records page.');
        }
    },
   
    updateSchoolYearAndTerms: async (req, res, db) => {
        const { yearId, year_label, currentYear, termIds, termNames, startDates, endDates, currentTerm, termClasses } = req.body;
        const { organizationId } = req.session;
    
        try {
            // Validate if a current term is selected for the current year
            if (currentYear && !currentTerm) {
                req.flash('error', 'School year cannot be set as current because no term is selected. Please select a term.');
                return res.redirect('/common/manageRecords');
            }
    
            // Begin transaction
            await db.query('BEGIN');
    
            // Update the school year label
            await db.query('UPDATE school_years SET year_label = $1 WHERE id = $2 AND organization_id = $3', [year_label, yearId, organizationId]);
    
            // Ensure only one school year is marked as current
            if (currentYear) {
                await db.query('UPDATE school_years SET current = FALSE WHERE organization_id = $1', [organizationId]); // Deselect all
                await db.query('UPDATE school_years SET current = TRUE WHERE id = $1 AND organization_id = $2', [yearId, organizationId]); // Set selected school year as current
            }
    
            // Update each term's details
            for (let i = 0; i < termIds.length; i++) {
                const termId = termIds[i];
                const termName = termNames[i];
                const startDate = startDates[i];
                const endDate = endDates[i];
                const isCurrent = currentTerm && currentTerm.includes(termId);
    
                // Ensure only one term is marked as current
                if (isCurrent) {
                    await db.query('UPDATE terms SET current = FALSE WHERE organization_id = $1', [organizationId]); // Deselect all
                    await db.query('UPDATE terms SET current = TRUE WHERE term_id = $1 AND organization_id = $2', [termId, organizationId]); // Set selected term as current
                }
    
                // Update the term information
                await db.query('UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5', 
                    [termName, startDate, endDate, termId, organizationId]);
    
                // Fetch the existing classes for the term from the database
                const existingClassesResult = await db.query('SELECT class_id FROM term_classes WHERE term_id = $1 AND organization_id = $2', [termId, organizationId]);
                const existingClasses = existingClassesResult.rows.map(row => row.class_id);
    
                // Handle the structure of selected classes, if any are provided
                const selectedClasses = termClasses && termClasses[i] ? (Array.isArray(termClasses[i]) ? termClasses[i] : [termClasses[i]]) : [];
    
                // Find classes to add (those that are in the form but not in the database)
                const classesToAdd = selectedClasses.filter(classId => !existingClasses.includes(parseInt(classId)));
    
                // Find classes to delete (those that are in the database but not in the form)
                const classesToDelete = existingClasses.filter(classId => !selectedClasses.includes(classId.toString()));
    
                // Insert new classes that were selected in the form
                for (const classId of classesToAdd) {
                    await db.query(
                        'INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)',
                        [termId, classId, organizationId]
                    );
                }
    
                // Delete classes that were unselected in the form
                for (const classId of classesToDelete) {
                    await db.query(
                        'DELETE FROM term_classes WHERE term_id = $1 AND class_id = $2 AND organization_id = $3',
                        [termId, classId, organizationId]
                    );
                }
            }
    
            // Commit transaction
            await db.query('COMMIT');
            req.flash('success', 'School year and terms updated successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error updating school year and terms:', error);
            req.flash('error', 'Failed to update school year and terms.');
            res.redirect('/common/manageRecords');
        }
    },
         
    // Render Create Event & Announcement Form (GET)
createEventAnnouncementGet: (req, res) => {
    res.render('common/createEventAnnouncement', {
        title: 'Create Event & Announcement',
        messages: req.flash()
    });
},

// Handle Create Event & Announcement Form (POST)
createEventAnnouncementPost: async (req, res, db) => {
    const { type } = req.body;
    
    try {
        // Log the incoming request body
        console.log("Form Data: ", req.body);

        // Fetch the current school year and term for the organization
        const currentSchoolYearTerm = await db.query(`
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `, [req.session.organizationId]);

        if (currentSchoolYearTerm.rows.length === 0) {
            req.flash('error', 'No current school year or term found. Please set the current school year and term.');
            return res.redirect('/common/manageRecords');
        }

        const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

        // Log the values being used in the SQL query
        console.log('Announcement Data:', {
            message: req.body.announcementMessage,
            visibility: req.body.visibility,
            organizationId: req.session.organizationId,
            school_year_id: school_year_id,
            term_id: term_id
        });

        if (type === 'event') {
            // Insert new event with the current school year and term
            await db.query(
                'INSERT INTO school_events (name, event_date, details, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [req.body.eventName, req.body.eventDate, req.body.eventDetails, req.body.visibility, req.session.organizationId, school_year_id, term_id]
            );
        } else if (type === 'announcement') {
            // Insert new announcement with the current school year and term
            await db.query(
                'INSERT INTO announcements (message, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5)',
                [req.body.announcementMessage, req.body.visibility, req.session.organizationId, school_year_id, term_id]
            );
        }

        req.flash('success', 'Event/Announcement created successfully.');
        res.redirect('/common/orgDashboard');
    } catch (err) {
        // Log the error to understand what went wrong
        console.error('Error creating event/announcement:', err);

        req.flash('error', 'Error creating event/announcement.');
        res.status(500).redirect('/common/createEventAnnouncement');
    }
},



// Manage Events & Announcements (GET)
manageEventsAnnouncementsGet: async (req, res, db) => {
    try {
        // Fetch the current school year and term
        const currentSchoolYearTerm = await db.query(`
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `, [req.session.organizationId]);

        if (currentSchoolYearTerm.rows.length === 0) {
            req.flash('error', 'No current school year or term found.');
            return res.redirect('/common/manageRecords');
        }

        const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

        // Fetch events and announcements tied to the current school year and term
        const events = await db.query('SELECT * FROM school_events WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3', [req.session.organizationId, school_year_id, term_id]);
        const announcements = await db.query('SELECT * FROM announcements WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3', [req.session.organizationId, school_year_id, term_id]);

        res.render('common/manageEventsAnnouncements', {
            title: 'Manage Events & Announcements',
            events: events.rows,
            announcements: announcements.rows,
            messages: req.flash()
        });
    } catch (err) {
        req.flash('error', 'Error loading events and announcements.');
        res.status(500).redirect('/common/manageEventsAnnouncements');
    }
},


    // Update Event (POST)
updateEvent: async (req, res, db) => {
    const { id, name, eventDate, details, visibility } = req.body;
    try {
        await db.query(
            'UPDATE events SET name = $1, event_date = $2, details = $3, visibility = $4 WHERE id = $5 AND organization_id = $6',
            [name, eventDate, details, visibility, id, req.session.organizationId]
        );
        req.flash('success', 'Event updated successfully.');
        res.redirect('/common/manageEventsAnnouncements');
    } catch (err) {
        req.flash('error', 'Error updating event.');
        res.status(500).redirect('/common/manageEventsAnnouncements');
    }
},

// Update Announcement (POST)
updateAnnouncement: async (req, res, db) => {
    const { id, message, visibility } = req.body;
    try {
        await db.query(
            'UPDATE announcements SET message = $1, visibility = $2 WHERE announcement_id = $3 AND organization_id = $4',
            [message, visibility, id, req.session.organizationId]
        );
        req.flash('success', 'Announcement updated successfully.');
        res.redirect('/common/manageEventsAnnouncements');
    } catch (err) {
        req.flash('error', 'Error updating announcement.');
        res.status(500).redirect('/common/manageEventsAnnouncements');
    }
},

    addClassSubject: async (req, res, db) => {
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
    },

    addClass: async (req, res, db) => {
        const { className } = req.body; // This will be an array of class names
    const { organizationId } = req.session;

    if (!className || className.length === 0) {
        req.flash('error', 'Please provide at least one class name.');
        return res.redirect('/common/addClassSubject');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        for (let name of className) {
            if (name.trim() !== '') {
                await client.query(
                    'INSERT INTO classes (class_name, organization_id) VALUES ($1, $2)',
                    [name.trim(), organizationId]
                );
            }
        }

        await client.query('COMMIT');
        req.flash('success', 'Classes added successfully.');
        res.redirect('/common/addClassSubject');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding classes:', error);
        req.flash('error', 'Failed to add classes.');
        res.redirect('/common/addClassSubject');
    } finally {
        client.release();
    }
    },

    addSubject: async (req, res, db) => {
        const { subjectName, classId } = req.body; // Arrays of subject names and class IDs
        const { organizationId } = req.session;
    
        // Ensure we have at least one subject name and one class ID
        if (!subjectName || subjectName.length === 0) {
            req.flash('error', 'Please provide at least one subject name.');
            return res.redirect('/common/addClassSubject');
        }
    
        if (!classId || classId.length === 0) {
            req.flash('error', 'Please select at least one class.');
            return res.redirect('/common/addClassSubject');
        }
    
        const client = await db.connect();
        try {
            await client.query('BEGIN');
    
            for (let i = 0; i < subjectName.length; i++) {
                const name = subjectName[i].trim();
    
                // Only add the subject if the name is not empty
                if (name !== '') {
                    // Ensure classId is an array and convert to individual integers
                    let classIds = Array.isArray(classId) ? classId.map(Number) : [parseInt(classId)];
    
                    // Loop through classIds and insert each subject-class pair
                    for (let classIdValue of classIds) {
                        // Check if this subject already exists for the given class to avoid duplicates
                        const existingSubject = await client.query(
                            'SELECT * FROM subjects WHERE subject_name = $1 AND class_id = $2 AND organization_id = $3',
                            [name, classIdValue, organizationId]
                        );
    
                        // If the subject does not already exist, insert it
                        if (existingSubject.rows.length === 0) {
                            await client.query(
                                'INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3)',
                                [name, classIdValue, organizationId]
                            );
                        }
                    }
                }
            }
    
            await client.query('COMMIT');
            req.flash('success', 'Subjects added successfully.');
            res.redirect('/common/addClassSubject');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error adding subjects:', error);
            req.flash('error', 'Failed to add subjects.');
            res.redirect('/common/addClassSubject');
        } finally {
            client.release();
        }    },

    updateTerm: async (req, res, db) => {
        const { term_id, term_name, start_date, end_date } = req.body;
        try {
            await db.query('UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5', [term_name, start_date, end_date, term_id, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Failed to update term:', error);
            res.status(500).send('Error updating term');
        }
    },

    deleteTerm: async (req, res, db) => {
        const { term_id } = req.body;
        try {
            await db.query('DELETE FROM terms WHERE term_id = $1 AND organization_id = $2', [term_id, req.session.organizationId]);
            res.json({ success: true, message: 'Term deleted successfully.' });
        } catch (error) {
            console.error('Error deleting term:', error);
            res.status(500).json({ success: false, message: 'Failed to delete term.' });
        }
    },

    addGraduationYearGroup: async (req, res, db) => {
        const { graduationYear } = req.body; // Array of graduation years
    const { organizationId } = req.session;

    if (!graduationYear || graduationYear.length === 0) {
        req.flash('error', 'Please provide at least one graduation year.');
        return res.redirect('/common/addClassSubject');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        for (let year of graduationYear) {
            if (year.trim() !== '') {
                const yearGroup = `Graduation Class of ${year.trim()} Group`;
                await client.query(
                    'INSERT INTO graduation_year_groups (name, organization_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
                    [yearGroup, organizationId]
                );
            }
        }

        await client.query('COMMIT');
        req.flash('success', 'Graduation year groups added successfully.');
        res.redirect('/common/addClassSubject');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding graduation year groups:', error);
        req.flash('error', 'Failed to add graduation year groups.');
        res.redirect('/common/addClassSubject');
    } finally {
        client.release();
    }
    },

    manageClassSubjectAndGradYr: async (req, res, db) => {
        try {
            const graduationYearsResult = await db.query('SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name', [req.session.organizationId]);
            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name', [req.session.organizationId]);
            const subjectsResult = await db.query('SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name', [req.session.organizationId]);

            res.render('common/manageClassSubjectAndGradYr', {
                title: 'Modify Class, Subject & Grad Year',
                graduationYearGroups: graduationYearsResult.rows,
                classes: classesResult.rows,
                subjects: subjectsResult.rows,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        } catch (error) {
            console.error('Error fetching data:', error);
            res.status(500).send('Error loading the management page.');
        }
    },

    management: async (req, res, db) => {
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
    },

    editGraduationYearGroup: async (req, res, db) => {
        const { id, newName } = req.body;
        try {
            await db.query('UPDATE graduation_year_groups SET name = $1 WHERE id = $2 AND organization_id = $3', [newName, id, req.session.organizationId]);
            req.flash('success', 'Graduation year group updated successfully.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error updating graduation year group:', error);
            req.flash('error', 'Failed to update graduation year group.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        }
    },
    
    deleteGraduationYearGroup: async (req, res, db) => {
        const { id } = req.query;
        try {
            await db.query('DELETE FROM graduation_year_groups WHERE id = $1 AND organization_id = $2', [id, req.session.organizationId]);
            req.flash('success', 'Graduation year group deleted successfully.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error deleting graduation year group:', error);
            req.flash('error', 'Failed to delete graduation year group.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        }
    },
    
    deleteClass: async (req, res, db) => {
        const { classId } = req.query;
    
        try {
            // Warn the user about the consequences of deleting the class
            req.flash('warning', 'This will delete all associated subjects and user data. Are you sure?');
    
            // Check if the class has associated subjects and delete them first
            const subjects = await db.query('SELECT subject_id FROM subjects WHERE class_id = $1', [classId]);
    
            for (let subject of subjects.rows) {
                // Delete associated records from user_subjects for each subject
                await db.query('DELETE FROM user_subjects WHERE subject_id = $1', [subject.subject_id]);
    
                // Delete the subject itself
                await db.query('DELETE FROM subjects WHERE subject_id = $1', [subject.subject_id]);
            }
    
            // Now, delete the class after its subjects and dependencies have been removed
            await db.query('DELETE FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
    
            req.flash('success', 'Class and all associated subjects deleted successfully.');
        } catch (error) {
            console.error('Error deleting class:', error);
            req.flash('error', 'Failed to delete class. ' + error.message);
        }
    
        res.redirect('/common/manageClassSubjectAndGradYr');
    },
    
        
    
    editClass: async (req, res, db) => {
        const { classId, newClassName } = req.body;
        try {
            await db.query('UPDATE classes SET class_name = $1 WHERE class_id = $2 AND organization_id = $3', [newClassName, classId, req.session.organizationId]);
            req.flash('success', 'Class updated successfully.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error updating class:', error);
            req.flash('error', 'Failed to update class.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        }
    },
    
  getSubjectsByClass: async (req, res, db) => {
    const { classId } = req.query;
    if (!classId) {
        return res.status(400).json({ error: 'Class ID is required.' });
    }
    
    try {
        const subjectsResult = await db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name', [classId, req.session.organizationId]);
        res.json(subjectsResult.rows);
    } catch (error) {
        console.error('Error fetching subjects for class:', error);
        res.status(500).json({ error: 'Failed to load subjects.' });
    }
},
    
editSubject: async (req, res, db) => {
    const { subjectId, newName } = req.body;
    try {
        // console.log(`Editing subject with ID: ${subjectId}, New Name: ${newName}`);
        await db.query(
            'UPDATE subjects SET subject_name = $1 WHERE subject_id = $2 AND organization_id = $3',
            [newName, subjectId, req.session.organizationId]
        );
        req.flash('success', 'Subject updated successfully.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    } catch (error) {
        console.error('Error updating subject:', error);
        req.flash('error', 'Failed to update subject.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    }
},

deleteSubject: async (req, res, db) => {
    const { subjectId } = req.query;

    try {
        // console.log(`Deleting subject with ID: ${subjectId}`);
        // Delete all user_subjects entries related to the subject
        await db.query('DELETE FROM user_subjects WHERE subject_id = $1', [subjectId]);

        // Now delete the subject
        await db.query('DELETE FROM subjects WHERE subject_id = $1 AND organization_id = $2', [subjectId, req.session.organizationId]);

        req.flash('success', 'Subject deleted successfully.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    } catch (err) {
        console.error('Error deleting subject:', err);
        req.flash('error', 'Failed to delete subject.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    }
},

    getGradYearGroupByClassId: async (req, res, db) => {
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
    },

    
    closeSchoolYear: async (req, res, db) => {
        try {
            const { organizationId } = req.session;
    
            // Fetch school years and their terms associated with the current organization
            const schoolYearResult = await db.query(`
                SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1
                ORDER BY sy.year_label, t.start_date
            `, [organizationId]);
    
            let schoolYears = [];
    
            // Iterate over each result and build the school years with their terms
            schoolYearResult.rows.forEach(row => {
                let year = schoolYears.find(y => y.year_label === row.year_label);
                if (!year) {
                    year = { year_label: row.year_label, terms: [] };
                    schoolYears.push(year);
                }
                if (row.term_id) {
                    year.terms.push({ term_id: row.term_id, term_name: row.term_name });
                }
            });
    
            // Render the Close School Year page with the data
            res.render('common/closeSchoolYear', {
                title: 'Close School Year',  // Pass the title
                schoolYears,                 // Pass the retrieved school years and terms
                organizationId               // Pass the organization ID for further usage if needed
            });
        } catch (error) {
            console.error('Error fetching school year data:', error);
            req.flash('error', 'Failed to load school year data.');
            res.redirect('/');
        }
    },
        
    
    termDetails: async (req, res, db) => {
        const { termId } = req.params;
        const organizationId = req.session.organizationId;
    
        try {
            // Fetch term details
            const termResult = await db.query(`
                SELECT term_id, term_name, start_date, end_date
                FROM terms
                WHERE term_id = $1 AND organization_id = $2
            `, [termId, organizationId]);
    
            const term = termResult.rows[0];
            if (!term) {
                req.flash('error', 'Invalid term selected.');
                return res.redirect('/common/closeSchoolYear');
            }
    
            // Fetch classes for this term
            const classesResult = await db.query(`
                SELECT c.class_id, c.class_name
                FROM classes c
                INNER JOIN term_classes tc ON c.class_id = tc.class_id
                WHERE tc.term_id = $1 AND c.organization_id = $2
            `, [termId, organizationId]);
    
            const classes = classesResult.rows;
    
            // Pass title, termId, and classes to the view
            res.render('common/termDetails', {
                title: 'Term Details',  // Set the title here
                term,
                classes,
                termId,  // Pass termId to the view
                organizationId
            });
        } catch (error) {
            console.error('Error fetching term details:', error);
            req.flash('error', 'Failed to load term details.');
            res.redirect('/common/closeSchoolYear');
        }
    },
    
             
    
    closeGraduationYearGroup: async (req, res, db) => {
        try {
            const gradYearGroupsResult = await db.query('SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name', [req.session.organizationId]);
            const studentsResult = await db.query('SELECT * FROM students WHERE organization_id = $1 ORDER BY last_name, first_name', [req.session.organizationId]);

            const gradYearGroups = gradYearGroupsResult.rows.map(group => {
                return {
                    ...group,
                    students: studentsResult.rows.filter(student => student.graduation_year_group_id === group.id)
                };
            });

            res.render('common/closeGraduationYearGroup', { title: 'Close Graduation Year Group', gradYearGroups });
        } catch (error) {
            console.error('Error fetching graduation year groups and students:', error);
            res.status(500).send('Failed to load close graduation year group page.');
        }
    },

    closeGraduationYearGroupPost: async (req, res, db) => {
        const { students, action } = req.body;
        try {
            const studentIds = Array.isArray(students) ? students : [students];
            if (action.startsWith('end_')) {
                const studentId = action.split('_')[1];
                await db.query('UPDATE students SET graduated = TRUE WHERE student_id = $1 AND organization_id = $2', [studentId, req.session.organizationId]);
            } else if (action.startsWith('change_')) {
                const studentId = action.split('_')[1];
                const newGradYearGroupId = req.body.newGradYearGroupId;
                await db.query('UPDATE students SET graduation_year_group_id = $1 WHERE student_id = $2 AND organization_id = $3', [newGradYearGroupId, studentId, req.session.organizationId]);
            }
            res.redirect('/common/closeGraduationYearGroup');
        } catch (error) {
            console.error('Error closing graduation year group:', error);
            res.status(500).send('Failed to close graduation year group.');
        }
    },

// Delete Event (POST)
deleteEvent: async (req, res, db) => {
    const { id } = req.body;
    try {
        await db.query('DELETE FROM events WHERE id = $1 AND organization_id = $2', [id, req.session.organizationId]);
        req.flash('success', 'Event deleted successfully.');
        res.redirect('/common/manageEventsAnnouncements');
    } catch (err) {
        req.flash('error', 'Error deleting event.');
        res.status(500).redirect('/common/manageEventsAnnouncements');
    }
},

// Delete Announcement (POST)
deleteAnnouncement: async (req, res, db) => {
    const { id } = req.body;
    try {
        await db.query('DELETE FROM announcements WHERE announcement_id = $1 AND organization_id = $2', [id, req.session.organizationId]);
        req.flash('success', 'Announcement deleted successfully.');
        res.redirect('/common/manageEventsAnnouncements');
    } catch (err) {
        req.flash('error', 'Error deleting announcement.');
        res.status(500).redirect('/common/manageEventsAnnouncements');
    }
},

    deleteSchoolYear: async (req, res, db) => {
        const { yearId } = req.body;
        try {
            await db.query('DELETE FROM term_classes WHERE term_id IN (SELECT term_id FROM terms WHERE school_year_id = $1)', [yearId]);
            await db.query('DELETE FROM terms WHERE school_year_id = $1', [yearId]);
            await db.query('DELETE FROM school_years WHERE id = $1 AND organization_id = $2', [yearId, req.session.organizationId]);

            req.flash('success', 'School year deleted successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error deleting school year:', error);
            req.flash('error', 'Failed to delete school year.');
            res.redirect('/common/manageRecords');
        }
    },
    
    deleteSchoolYearPost: async (req, res, db) => {
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
    }
    };

module.exports = {
    upload,
    isAuthenticated,
    getClassName,
    generateDates,
    commonController
};