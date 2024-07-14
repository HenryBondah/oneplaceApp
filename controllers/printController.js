const printController = (db) => ({
    printStudentReport: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, organizationId]);
            const classData = classResult.rows[0];
            if (!classData) {
                throw new Error('Class not found for the given class ID and organization ID.');
            }

            // Fetch organization details
            const organizationResult = await db.query('SELECT organization_name, organization_address FROM organizations WHERE organization_id = $1', [organizationId]);
            const organization = organizationResult.rows[0];
            if (!organization) {
                throw new Error('Organization not found');
            }

            // Fetch students by class
            const students = await fetchStudentsByClass(db, classId);
            if (!students || students.length === 0) {
                res.render('print/printStudentReport', {
                    title: 'Student Final Report',
                    class: classData,
                    students: [],
                    orgName: organization.organization_name,
                    orgAddress: organization.organization_address,
                    date: new Date().toLocaleDateString(),
                    teacherRemarks: [],
                    term: {},
                });
                return;
            }

            // Fetch report settings
            const settingsResult = await db.query('SELECT * FROM report_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
            const reportSettings = settingsResult.rows[0] || {};
            const cutOffPoint = reportSettings.cut_off_point || 50;
            const promotedClass = reportSettings.promoted_class || 'Next Class';
            const repeatedClass = reportSettings.repeated_class || 'Same Class';
            const scoreRemark = reportSettings.score_remark || [];
            const teacherRemarks = reportSettings.teacher_remarks || [];

            // Hardcoded subjects and scores for each student
            const hardcodedSubjects = [
                { subject_name: 'Mathematics', class_score: 80, exams_score: 90, total_score: 170, grade: 'A', position: 1, remarks: 'Excellent' },
                { subject_name: 'Science', class_score: 75, exams_score: 85, total_score: 160, grade: 'B+', position: 2, remarks: 'Very Good' },
                { subject_name: 'History', class_score: 70, exams_score: 80, total_score: 150, grade: 'B', position: 3, remarks: 'Good' }
            ];

            for (const student of students) {
                student.subjects = hardcodedSubjects;

                // Fetch attendance
                const attendanceResult = await db.query(`
                    SELECT COUNT(*) as attendance
                    FROM attendance_records
                    WHERE student_id = $1 AND status = 'Present'
                `, [student.student_id]);
                student.attendance = attendanceResult.rows[0].attendance;

                // Determine promotion status
                const totalScore = student.subjects.reduce((acc, subject) => acc + subject.total_score, 0) / student.subjects.length;
                student.promotionStatus = totalScore >= cutOffPoint ? `Promoted to: ${promotedClass}` : `Repeated: ${repeatedClass}`;
            }

            // Fetch term details
            const termResult = await db.query('SELECT * FROM terms WHERE organization_id = $1 AND current = TRUE', [organizationId]);
            const term = termResult.rows[0];

            res.render('print/printStudentReport', {
                title: 'Student Final Report',
                class: classData,
                students: students,
                orgName: organization.organization_name || 'Default School Name',
                orgAddress: organization.organization_address,
                date: new Date().toLocaleDateString(),
                teacherRemarks: teacherRemarks,
                term: term || {} // Pass term data to the view
            });
        } catch (error) {
            console.error('Error generating student report:', error);
            res.status(500).send('Failed to generate student report.');
        }
    },

    remarksPage: async (req, res) => {
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            const classesResult = await db.query('SELECT * FROM classes WHERE organization_id = $1', [organizationId]);
            const classes = classesResult.rows;

            const settingsResult = await db.query('SELECT * FROM report_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
            const settings = settingsResult.rows[0] || { 
                cut_off_point: 50, 
                promoted_class: 'Next Class', 
                repeated_class: 'Same Class', 
                school_reopen_date: new Date().toISOString().split('T')[0], 
                score_remark: [], 
                teacher_remarks: [] 
            };

            res.render('print/remarks', {
                title: 'Manage Remarks',
                settings: settings,
                classes: classes
            });
        } catch (error) {
            console.error('Error fetching remarks:', error);
            res.status(500).send('Failed to fetch remarks.');
        }
    },

    saveRemarks: async (req, res) => {
        const { cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, scoreRemarks, teacherRemarks } = req.body;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            // Save or update the report settings
            await db.query(`
                INSERT INTO report_settings (organization_id, cut_off_point, promoted_class, repeated_class, school_reopen_date, score_remark, teacher_remarks)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (organization_id) DO UPDATE
                SET cut_off_point = EXCLUDED.cut_off_point,
                    promoted_class = EXCLUDED.promoted_class,
                    repeated_class = EXCLUDED.repeated_class,
                    school_reopen_date = EXCLUDED.school_reopen_date,
                    score_remark = EXCLUDED.score_remark,
                    teacher_remarks = EXCLUDED.teacher_remarks
            `, [organizationId, cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, scoreRemarks, teacherRemarks]);

            res.redirect('/print/remarks');
        } catch (error) {
            console.error('Error saving remarks:', error);
            res.status(500).send('Failed to save remarks.');
        }
    },

    deleteRemarks: async (req, res) => {
        const { id } = req.params;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            await db.query('DELETE FROM general_remarks WHERE id = $1 AND organization_id = $2', [id, organizationId]);
            res.redirect('/print/remarks');
        } catch (error) {
            console.error('Error deleting remark:', error);
            res.status(500).send('Failed to delete remark.');
        }
    },

    editRemarks: async (req, res) => {
        const { id } = req.params;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            const remarkResult = await db.query('SELECT * FROM general_remarks WHERE id = $1 AND organization_id = $2', [id, organizationId]);
            if (remarkResult.rows.length === 0) {
                return res.status(404).send('Remark not found.');
            }

            const remark = remarkResult.rows[0];
            res.render('print/editRemarks', {
                title: 'Edit Remark',
                remark: remark
            });
        } catch (error) {
            console.error('Error fetching remark:', error);
            res.status(500).send('Failed to fetch remark.');
        }
    },

    updateRemarks: async (req, res) => {
        const { id, remarks } = req.body;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            await db.query(`
                UPDATE general_remarks
                SET remarks = $1
                WHERE id = $2 AND organization_id = $3
            `, [remarks, id, organizationId]);

            res.redirect('/print/remarks');
        } catch (error) {
            console.error('Error updating remark:', error);
            res.status(500).send('Failed to update remark.');
        }
    }
});

// Fetch students by class function
async function fetchStudentsByClass(db, classId) {
    try {
        const studentsResult = await db.query(`
            SELECT student_id, first_name, last_name, image_url, class_id
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

module.exports = printController;
