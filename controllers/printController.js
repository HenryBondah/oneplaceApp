const printController = (db) => ({
    printStudentReport: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        try {
            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, organizationId]);
            const classData = classResult.rows[0];

            // Fetch organization details
            const organizationResult = await db.query('SELECT organization_name, organization_address FROM organizations WHERE organization_id = $1', [organizationId]);
            const organization = organizationResult.rows[0];

            // Fetch students by class
            const students = await fetchStudentsByClass(db, classId);

            // Hardcoded subjects and scores for each student
            const hardcodedSubjects = [
                { subject_name: 'Mathematics', class_score: 80, exams_score: 90, total_score: 170, grade: 'A', position: 1, remarks: 'Excellent' },
                { subject_name: 'Science', class_score: 75, exams_score: 85, total_score: 160, grade: 'B+', position: 2, remarks: 'Very Good' },
                { subject_name: 'History', class_score: 70, exams_score: 80, total_score: 150, grade: 'B', position: 3, remarks: 'Good' }
            ];

            for (const student of students) {
                student.subjects = hardcodedSubjects;

                // Fetch teacher remarks
                const teacherRemarksResult = await db.query(`
                    SELECT remarks
                    FROM teacher_remarks
                    WHERE student_id = $1
                `, [student.student_id]);
                student.teacherRemarks = teacherRemarksResult.rows.length > 0 ? teacherRemarksResult.rows[0].remarks : "";

                // Fetch head teacher remarks
                const headTeacherRemarksResult = await db.query(`
                    SELECT remarks
                    FROM head_teacher_remarks
                    WHERE student_id = $1
                `, [student.student_id]);
                student.headTeacherRemarks = headTeacherRemarksResult.rows.length > 0 ? headTeacherRemarksResult.rows[0].remarks : "";

                // Fetch attendance
                const attendanceResult = await db.query(`
                    SELECT COUNT(*) as attendance
                    FROM attendance_records
                    WHERE student_id = $1 AND status = 'Present'
                `, [student.student_id]);
                student.attendance = attendanceResult.rows[0].attendance;
            }

            // Fetch all remarks for dropdown
            const teacherRemarksResult = await db.query('SELECT DISTINCT remarks FROM general_remarks WHERE type = $1 AND organization_id = $2', ['teacher', organizationId]);
            const headTeacherRemarksResult = await db.query('SELECT DISTINCT remarks FROM general_remarks WHERE type = $1 AND organization_id = $2', ['head_teacher', organizationId]);
            const teacherRemarks = teacherRemarksResult.rows;
            const headTeacherRemarks = headTeacherRemarksResult.rows;

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
                headTeacherRemarks: headTeacherRemarks,
                term: term // Pass term data to the view
            });
        } catch (error) {
            console.error('Error generating student report:', error);
            res.status(500).send('Failed to generate student report.');
        }
    },

    calculateFinalGrade: (subjects) => {
        let total = 0;
        subjects.forEach(subject => {
            total += printController.gradeToPoint(subject.grade);
        });
        return total / subjects.length;
    },

    gradeToPoint: (grade) => {
        const gradePoints = {
            'A': 4.0,
            'B+': 3.5,
            'B': 3.0,
            'C+': 2.5,
            'C': 2.0,
            'D+': 1.5,
            'D': 1.0,
            'F': 0.0
        };
        return gradePoints[grade] || 0.0;
    },

    calculatePosition: async (studentId, classId, db) => {
        const studentsResult = await db.query('SELECT * FROM students WHERE class_id = $1 AND organization_id = $2', [classId, organizationId]);
        const students = studentsResult.rows;

        students.forEach(student => {
            student.final_grade = printController.calculateFinalGrade(student.subjects || []);
        });

        students.sort((a, b) => b.final_grade - a.final_grade);

        return students.findIndex(student => student.student_id === studentId) + 1;
    },

    // Other functions for remarks management as defined earlier

    remarksPage: async (req, res) => {
        const organizationId = req.session.organizationId;

        try {
            const teacherRemarks = await db.query('SELECT * FROM general_remarks WHERE type = $1 AND organization_id = $2', ['teacher', organizationId]);
            const headTeacherRemarks = await db.query('SELECT * FROM general_remarks WHERE type = $1 AND organization_id = $2', ['head_teacher', organizationId]);

            res.render('print/remarks', {
                title: 'Manage Remarks',
                teacherRemarks: teacherRemarks.rows,
                headTeacherRemarks: headTeacherRemarks.rows
            });
        } catch (error) {
            console.error('Error fetching remarks:', error);
            res.status(500).send('Failed to fetch remarks.');
        }
    },

    saveRemarks: async (req, res) => {
        const { teacherRemarks, headTeacherRemarks } = req.body;
        const organizationId = req.session.organizationId;

        try {
            if (teacherRemarks) {
                await db.query(`
                    INSERT INTO general_remarks (organization_id, type, remarks)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (organization_id, type, remarks) DO NOTHING
                `, [organizationId, 'teacher', teacherRemarks]);
            }

            if (headTeacherRemarks) {
                await db.query(`
                    INSERT INTO general_remarks (organization_id, type, remarks)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (organization_id, type, remarks) DO NOTHING
                `, [organizationId, 'head_teacher', headTeacherRemarks]);
            }

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
