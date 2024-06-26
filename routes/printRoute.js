module.exports = function(app, db) {
    // Middleware to ensure organization ID is present in session
    function ensureOrganizationId(req, res, next) {
        if (!req.session.organizationId) {
            console.error('Organization ID not found in session');
            return res.status(400).send('Organization not found. Please log in again.');
        }
        next();
    }

    // Route for printing detailed student report with remarks
    app.get('/print/printStudentReport', ensureOrganizationId, async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        try {
            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1', [classId]);
            const classData = classResult.rows[0];

            // Fetch students in the class
            const studentsResult = await db.query('SELECT * FROM students WHERE class_id = $1', [classId]);
            const students = studentsResult.rows;

            // Fetch subjects and grades for each student
            for (const student of students) {
                const subjectsResult = await db.query(`
                    SELECT s.subject_name, ss.grade
                    FROM student_subjects ss
                    JOIN subjects s ON ss.subject_id = s.subject_id
                    WHERE ss.student_id = $1
                `, [student.student_id]);
                student.subjects = subjectsResult.rows;

                // Fetch attendance
                const attendanceResult = await db.query(`
                    SELECT date, status
                    FROM attendance_records
                    WHERE student_id = $1
                `, [student.student_id]);
                student.attendance = attendanceResult.rows;

                // Calculate final grade and position
                student.final_grade = calculateFinalGrade(student.subjects);
                student.position = await calculatePosition(student.student_id, classId, db);

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
            }

            // Fetch all remarks for dropdown
            const teacherRemarksResult = await db.query('SELECT DISTINCT remarks FROM general_remarks WHERE type = $1 AND organization_id = $2', ['teacher', organizationId]);
            const headTeacherRemarksResult = await db.query('SELECT DISTINCT remarks FROM general_remarks WHERE type = $1 AND organization_id = $2', ['head_teacher', organizationId]);
            const teacherRemarks = teacherRemarksResult.rows;
            const headTeacherRemarks = headTeacherRemarksResult.rows;

            res.render('print/printStudentReport', {
                title: 'Student Final Report',
                class: classData,
                students: students,
                orgName: classData.org_name || 'Default School Name',
                date: new Date().toLocaleDateString(),
                teacherRemarks: teacherRemarks,
                headTeacherRemarks: headTeacherRemarks
            });
        } catch (error) {
            console.error('Error generating student report:', error);
            res.status(500).send('Failed to generate student report.');
        }
    });

    function calculateFinalGrade(subjects) {
        let total = 0;
        subjects.forEach(subject => {
            total += gradeToPoint(subject.grade);
        });
        return total / subjects.length;
    }

    function gradeToPoint(grade) {
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
    }

    async function calculatePosition(studentId, classId, db) {
        const studentsResult = await db.query('SELECT * FROM students WHERE class_id = $1', [classId]);
        const students = studentsResult.rows;

        students.sort((a, b) => b.final_grade - a.final_grade);

        return students.findIndex(student => student.student_id === studentId) + 1;
    }

    // Route for remarks page
    app.get('/print/remarks', ensureOrganizationId, async (req, res) => {
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
    });

    // Route to save or update general remarks
    app.post('/print/saveRemarks', ensureOrganizationId, async (req, res) => {
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
    });

    // Route to delete remarks
    app.get('/print/deleteRemarks/:id', ensureOrganizationId, async (req, res) => {
        const { id } = req.params;
        const organizationId = req.session.organizationId;

        try {
            await db.query('DELETE FROM general_remarks WHERE id = $1 AND organization_id = $2', [id, organizationId]);
            res.redirect('/print/remarks');
        } catch (error) {
            console.error('Error deleting remark:', error);
            res.status(500).send('Failed to delete remark.');
        }
    });

    // Route to edit remarks
    app.get('/print/editRemarks/:id', ensureOrganizationId, async (req, res) => {
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
    });

    // Route to update remarks
    app.post('/print/updateRemarks', ensureOrganizationId, async (req, res) => {
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
    });
};
