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

            const classes = await getClassesWithEmployees(db, organizationId);

            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date', [organizationId]);
            const events = eventsResult.rows.filter(event => event.visibility === 'org' || event.visibility === 'both');

            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 ORDER BY announcement_id DESC', [organizationId]);
            const announcements = announcementsResult.rows.filter(announcement => announcement.visibility === 'org' || announcement.visibility === 'both');

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

    publicDashboardContent: async (req, res,db) => {
        try {
            const organizationId = parseInt(req.query.organizationId, 10);
            if (isNaN(organizationId)) {
                throw new Error('Invalid organization_id');
            }

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

            const eventsResult = await db.query('SELECT * FROM school_events WHERE organization_id = $1 AND (visibility = $2 OR visibility = $3) ORDER BY event_date', [organizationId, 'public', 'both']);
            const events = eventsResult.rows;

            const announcementsResult = await db.query('SELECT * FROM announcements WHERE organization_id = $1 AND (visibility = $2 OR visibility = $3) ORDER BY announcement_id DESC', [organizationId, 'public', 'both']);
            const announcements = announcementsResult.rows;

            const imagesResult = await db.query('SELECT * FROM organization_images WHERE organization_id = $1 ORDER BY image_id', [organizationId]);
            const images = imagesResult.rows;

            const textsResult = await db.query('SELECT * FROM organization_texts WHERE organization_id = $1 ORDER BY text_id', [organizationId]);
            const texts = textsResult.rows;

            const heroImage = images.find(img => img.allocation === 'hero');
            const slideshowImages = images.filter(img => img.allocation === 'slideshow');

            res.render('common/publicDashboard', {
                title: 'Public Dashboard',
                schoolYear,
                currentTerm,
                events,
                announcements,
                organizationId,
                heroImage,
                slideshowImages,
                texts,
                layout: !req.session.organizationId // If not logged in, set layout to true
            });
        } catch (error) {
            console.error('Error fetching public dashboard data:', error);
            res.status(500).send('Failed to load public dashboard data.');
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
    
            const guardiansResult = await db.query(`
                SELECT * FROM guardians
                WHERE student_id = $1
            `, [studentId]);
    
            const assessmentsResult = await db.query(`
                SELECT a.assessment_id, a.title, a.weight, ar.score, a.subject_id, a.max_score, sub.subject_name
                FROM assessments a
                LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id
                LEFT JOIN subjects sub ON a.subject_id = sub.subject_id
                WHERE ar.student_id = $1
            `, [studentId]);
    
            const guardians = guardiansResult.rows;
            const assessments = assessmentsResult.rows;
    
            // Group assessments by subject and calculate grades, total scores, and positions
            const subjects = assessments.reduce((acc, assessment) => {
                let subject = acc.find(s => s.subject_id === assessment.subject_id);
                if (!subject) {
                    subject = {
                        subject_id: assessment.subject_id,
                        subject_name: assessment.subject_name,
                        totalScore: 0,
                        totalMaxScore: 0,
                        grade: '',
                        position: 0
                    };
                    acc.push(subject);
                }
                subject.totalScore += parseFloat(assessment.score) || 0;
                subject.totalMaxScore += parseFloat(assessment.max_score) || 0;
                return acc;
            }, []);
    
            subjects.forEach(subject => {
                const totalPercentage = subject.totalMaxScore > 0 ? (subject.totalScore / subject.totalMaxScore) * 100 : 0;
                subject.grade = calculateGrade(totalPercentage);
            });
    
            // Calculate positions based on total scores
            subjects.sort((a, b) => b.totalScore - a.totalScore);
            subjects.forEach((subject, index) => {
                subject.position = index + 1;
            });
    
            res.render('common/studentDetails', {
                title: 'Student Details',
                student,
                guardians,
                subjects,
                assessments,
                gradYearGroupName: student.grad_year_group_name || 'No graduation year group assigned',
                messages: req.flash()
            });
        } catch (err) {
            console.error('Error fetching student details:', err);
            res.status(500).send('Failed to fetch student details');
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

editStudentGet: async (req, res, db) => {
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
                SELECT g.name AS grad_year_group_name, g.id AS grad_year_group_id
                FROM classes c
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1
            `, [student.class_id]);
            const gradYearGroup = gradYearGroupResult.rows[0];

            const graduationYearGroupsResult = await db.query(`
                SELECT id, name
                FROM graduation_year_groups
                WHERE organization_id = $1
                ORDER BY name ASC;
            `, [req.session.organizationId]);

            res.render('common/editStudent', {
                title: 'Edit Student',
                student,
                classes: classes.rows,
                subjects: subjectsResult.rows,
                enrolledSubjects: enrolledSubjectIds,
                guardians,
                gradYearGroup,
                graduationYearGroups: graduationYearGroupsResult.rows,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error loading edit student page:', error);
            res.status(500).send('Failed to load student details.');
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
        const student = await db.query('SELECT image_url, class_id FROM students WHERE student_id = $1', [studentId]);
        if (student.rows.length > 0) {
            const imageUrl = student.rows[0].image_url;
            const classId = student.rows[0].class_id;
            if (imageUrl && imageUrl !== 'profilePlaceholder.png') {
                fs.unlinkSync(path.join(__dirname, '../uploads', imageUrl));
            }

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
    
            // Fetch students in the class, ordered by last name and first name
            let students = await db.query('SELECT student_id, first_name, last_name FROM students WHERE class_id = $1 AND organization_id = $2 ORDER BY last_name ASC, first_name ASC', [classId, req.session.organizationId]);
    
            // Fetch assessments for the subject
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, max_score
                FROM assessments
                WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3
                ORDER BY assessment_id`, [classId, subjectId, req.session.organizationId]);
            const assessments = assessmentsResult.rows;
    
            // Fetch scores for the students in this subject
            const resultsResult = await db.query(`
                SELECT ar.assessment_id, ar.student_id, ar.score, ar.total_subject_score, ar.total_percentage, ar.grade, ar.position
                FROM assessment_results ar
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
                        position: result.position,
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
    
            res.render('common/assessment', {
                title: 'Assessment',
                classId,
                className,
                subjectId,
                subjectName,
                assessments,
                students: students.rows,
                employees, // Pass the employees to the template
                messages: req.flash() // Pass messages to the template
            });
        } catch (err) {
            console.error('Error fetching assessment data:', err);
            res.status(500).send('Error fetching assessment data.');
        }
    },
    
    saveAllScores: async (req, res, db) => {
        const { subjectId } = req.query;
        const { scores } = req.body;

        try {
            // Fetch the assessments related to this subject
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, max_score
                FROM assessments
                WHERE subject_id = $1 AND organization_id = $2
                ORDER BY assessment_id`, [subjectId, req.session.organizationId]);

            const assessments = assessmentsResult.rows;

            await db.query('BEGIN');

            const studentScores = {};

            for (let studentId in scores) {
                let totalScore = 0;
                studentScores[studentId] = {}; 

                for (let assessmentId in scores[studentId]) {
                    let score = scores[studentId][assessmentId];
                    if (score === null || score === "") continue;

                    const assessmentResult = await db.query(
                        'SELECT max_score FROM assessments WHERE assessment_id = $1 AND subject_id = $2 AND organization_id = $3',
                        [assessmentId, subjectId, req.session.organizationId]
                    );

                    if (assessmentResult.rows.length === 0) continue;

                    totalScore += parseFloat(score);

                    studentScores[studentId][assessmentId] = score; 

                    await db.query(`
                        INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, organization_id)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (student_id, assessment_id)
                        DO UPDATE SET score = EXCLUDED.score
                    `, [studentId, assessmentId, score, subjectId, req.session.organizationId]);
                }

                const totalPercentage = commonController.calculateTotalPercentage(studentScores[studentId], assessments);
                const grade = commonController.calculateGrade(totalPercentage);

                const validTotalPercentage = totalPercentage !== "-" ? totalPercentage : null;
                const validGrade = grade !== "-" ? grade : null;

                await db.query(`
                    UPDATE assessment_results
                    SET total_subject_score = $1, total_percentage = $2, grade = $3
                    WHERE student_id = $4 AND subject_id = $5 AND organization_id = $6
                `, [totalScore, validTotalPercentage, validGrade, studentId, subjectId, req.session.organizationId]);
            }

            // Update positions based on total scores
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

// calculatePositions: (students) => {
//     // Sort students by total score in descending order
//     students.sort((a, b) => b.total_subject_score - a.total_subject_score);

//     let position = 1;
//     let lastScore = null;
//     let samePositionCount = 0;

//     students.forEach((student, index) => {
//         if (student.total_subject_score === lastScore) {
//             // If the score is the same as the last student's, assign the same position
//             student.position = position;
//             samePositionCount++;
//         } else {
//             // Otherwise, assign the current position and update it for the next distinct score
//             position += samePositionCount; // Increment position by the count of students who had the same score
//             student.position = position;
//             lastScore = student.total_subject_score;
//             samePositionCount = 1; // Reset the count for the new score
//         }
//     });

//     return students;
// },

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
    
            const assessmentsResult = await db.query(
                'SELECT assessment_id, title, weight, max_score FROM assessments WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 ORDER BY assessment_id',
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
        const { testName, testWeight, maxScore, classId, subjectId } = req.body;
        try {
            await db.query(
                'INSERT INTO assessments (title, weight, max_score, class_id, subject_id, organization_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
                [testName, testWeight, maxScore, classId, subjectId, req.session.organizationId, req.session.userId]
            );
            req.flash('success', 'Test created successfully.');
            res.json({ success: true });
        } catch (err) {
            console.error('Error creating test:', err);
            req.flash('error', 'Failed to create test.');
            res.status(500).json({ success: false, message: 'Failed to create test' });
        }
    },
    
    updateAssessments: async (req, res, db) => {
        const { classId, subjectId } = req.query;
        const { assessments } = req.body;
    
        try {
            await db.query('BEGIN');
    
            for (let assessmentId in assessments) {
                const { title, weight, maxScore } = assessments[assessmentId];
    
                // Replace old data with new data
                const result = await db.query(`
                    UPDATE assessments
                    SET title = $1, weight = $2, max_score = $3
                    WHERE assessment_id = $4 AND class_id = $5 AND subject_id = $6 AND organization_id = $7
                `, [title, parseFloat(weight), parseFloat(maxScore), assessmentId, classId, subjectId, req.session.organizationId]);
    
                if (result.rowCount === 0) {
                    console.error(`Failed to update assessment ID: ${assessmentId}`);
                } else {
                    // console.log(`Successfully updated assessment ID: ${assessmentId}`);
                }
            }
    
            await db.query('COMMIT');
    
            req.flash('success', 'Assessments updated successfully.');
            res.status(200).json({ success: true, message: 'Assessments updated successfully.' });
        } catch (err) {
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
    },
    
    registerSchoolYearGet: async (req, res, db) => { // Add this method
        try {
            const classesResult = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC', [req.session.organizationId]);
            res.render('common/registerSchoolYear', {
                title: 'Register School Year',
                classes: classesResult.rows,
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
        try {
            const { yearId, year_label, currentYear, termIds, termNames, startDates, endDates, currentTerm, termClasses } = req.body;
            const { organizationId } = req.session;

            await db.query('UPDATE school_years SET year_label = $1, current = $2 WHERE id = $3 AND organization_id = $4', [year_label, currentYear === 'true', yearId, organizationId]);

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
    },

    updateEvent: async (req, res, db) => {
        try {
            await db.query('UPDATE school_events SET name = $1, event_date = $2, details = $3, visibility = $4 WHERE id = $5 AND organization_id = $6', [req.body.name, req.body.event_date, req.body.details, req.body.visibility, req.body.id, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating event:', error);
            res.status(500).send('Failed to update event.');
        }
    },

    updateAnnouncement: async (req, res, db) => {
        const { announcementId, message, visibility } = req.body;
        try {
            await db.query('UPDATE announcements SET message = $1, visibility = $2 WHERE announcement_id = $3 AND organization_id = $4', [message, visibility, announcementId, req.session.organizationId]);
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error updating announcement:', error);
            res.status(500).send('Failed to update announcement.');
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
        const { className, gradYearGroupId } = req.body;
        const { organizationId } = req.session;

        const client = await db.connect();
        try {
            await client.query('BEGIN');

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
    },

    addSubject: async (req, res, db) => {
        const { subjectName, classId } = req.body;
        const { organizationId } = req.session;

        const client = await db.connect();
        try {
            await client.query('BEGIN');

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
    },

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
            await db.query('DELETE FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, req.session.organizationId]);
            req.flash('success', 'Class deleted successfully.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        } catch (error) {
            console.error('Error deleting class:', error);
            req.flash('error', 'Failed to delete class.');
            res.redirect('/common/manageClassSubjectAndGradYr');
        }
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
        await db.query('UPDATE subjects SET subject_name = $1 WHERE subject_id = $2 AND organization_id = $3', [newName, subjectId, req.session.organizationId]);
        req.flash('success', 'Subject updated successfully.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    } catch (error) {
        console.error('Error updating subject:', error);
        req.flash('error', 'Failed to update subject.');
        res.redirect('/common/manageClassSubjectAndGradYr');
    }
},

deleteSubject: async (req, res, db) => {
    const subjectId = req.query.subjectId;

    if (!subjectId) {
        req.flash('error', 'Subject ID is required.');
        return res.redirect('/common/manageClassSubjectAndGradYr');
    }

    try {
        await db.query('DELETE FROM subjects WHERE subject_id = $1 AND organization_id = $2', [subjectId, req.session.organizationId]);
        req.flash('success', 'Subject deleted successfully.');
    } catch (err) {
        console.error('Error deleting subject:', err);
        req.flash('error', 'Failed to delete subject.');
    }

    res.redirect('/common/manageClassSubjectAndGradYr');
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



    // getStudentsByClass: async (req, res, db) => {
    //     const classId = req.query.classId;

    //     if (!classId) {
    //         return res.status(400).json({ error: 'Class ID is required.' });
    //     }

    //     try {
    //         const students = await fetchStudentsByClass(db, classId, req.session.organizationId);

    //         if (students.length === 0) {
    //             return res.json({ error: 'No students found for the selected class.' });
    //         }

    //         res.json({ students });
    //     } catch (error) {
    //         console.error('Error fetching students:', error);
    //         res.status(500).json({ error: 'Error fetching students.' });
    //     }
    // },
    
    closeSchoolYear: async (req, res, db) => {
        try {
            const schoolYearsResult = await db.query('SELECT * FROM school_years WHERE organization_id = $1 ORDER BY year_label', [req.session.organizationId]);
            const termsResult = await db.query('SELECT * FROM terms WHERE organization_id = $1 ORDER BY start_date', [req.session.organizationId]);

            const schoolYears = schoolYearsResult.rows.map(schoolYear => {
                return {
                    ...schoolYear,
                    terms: termsResult.rows.filter(term => term.school_year_id === schoolYear.id)
                };
            });

            res.render('common/closeSchoolYear', { title: 'Close School Year', schoolYears });
        } catch (error) {
            console.error('Error fetching school years and terms:', error);
            res.status(500).send('Failed to load close school year page.');
        }
    },

    termDetails: async (req, res, db) => {
        const { termId } = req.query;
        try {
            const termResult = await db.query('SELECT * FROM terms WHERE term_id = $1 AND organization_id = $2', [termId, req.session.organizationId]);
            if (termResult.rows.length === 0) {
                return res.status(404).send('Term not found.');
            }

            const classesResult = await db.query(`
                SELECT c.class_id, c.class_name
                FROM term_classes tc
                JOIN classes c ON tc.class_id = c.class_id
                WHERE tc.term_id = $1 AND c.organization_id = $2
            `, [termId, req.session.organizationId]);

            res.render('common/termDetails', { 
                title: 'Term Details', 
                term: termResult.rows[0], 
                classes: classesResult.rows 
            });
        } catch (error) {
            console.error('Error fetching term details:', error);
            res.status(500).send('Failed to load term details page.');
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

    deleteEvent: async (req, res, db) => {
        const { eventId } = req.body;
        try {
            await db.query('DELETE FROM school_events WHERE id = $1 AND organization_id = $2', [eventId, req.session.organizationId]);
            req.flash('success', 'Event deleted successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error deleting event:', error);
            req.flash('error', 'Failed to delete event.');
            res.redirect('/common/manageRecords');
        }
    },

    deleteAnnouncement: async (req, res, db) => {
        const { announcementId } = req.body;
        try {
            await db.query('DELETE FROM announcements WHERE announcement_id = $1 AND organization_id = $2', [announcementId, req.session.organizationId]);
            req.flash('success', 'Announcement deleted successfully.');
            res.redirect('/common/manageRecords');
        } catch (error) {
            console.error('Error deleting announcement:', error);
            req.flash('error', 'Failed to delete announcement.');
            res.redirect('/common/manageRecords');
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