const printController = (db) => ({
    printStudentReport: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        try {
            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, organizationId]);
            const classData = classResult.rows[0];

            // Fetch students in the class
            const studentsResult = await db.query(`
                SELECT s.*, c.class_name, g.name as graduation_year_group
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE s.class_id = $1 AND s.organization_id = $2
            `, [classId, organizationId]);
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
                student.final_grade = printController.calculateFinalGrade(student.subjects);
                student.position = await printController.calculatePosition(student.student_id, classId, db);

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
                orgName: classData.organization_name || 'Default School Name',
                date: new Date().toLocaleDateString(),
                teacherRemarks: teacherRemarks,
                headTeacherRemarks: headTeacherRemarks
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

module.exports = printController;
