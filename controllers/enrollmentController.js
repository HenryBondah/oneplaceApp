const enrollmentController = {
    enrollmentGet: async (req, res, db) => {
        try {
            const organizationId = req.session.organizationId;

            // Fetch all school years for the organization
            const schoolYearResults = await db.query(`
                SELECT id AS school_year_id, year_label, current
                FROM school_years
                WHERE organization_id = $1
                ORDER BY created_at DESC
            `, [organizationId]);

            const schoolYears = schoolYearResults.rows;

            // Fetch terms for each school year
            const termResults = await db.query(`
                SELECT term_id, school_year_id, term_name, start_date, end_date
                FROM terms
                WHERE organization_id = $1
                ORDER BY start_date
            `, [organizationId]);

            const terms = termResults.rows;

            // Combine school years with their terms
            schoolYears.forEach(year => {
                year.terms = terms.filter(term => term.school_year_id === year.school_year_id);
            });

            // Fetch all classes
            const classesResult = await db.query(`
                SELECT class_id, class_name 
                FROM classes
                WHERE organization_id = $1
                ORDER BY class_name
            `, [organizationId]);

            const classes = classesResult.rows;

            res.render('enrollment/enrollment', {
                title: 'Enrollment',
                schoolYears,
                classes,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching enrollment data:', error);
            req.flash('error', 'Failed to load enrollment data.');
            res.redirect('/');
        }
    },

    enrollmentPost: async (req, res, db) => {
        const { schoolYearId, termId, selectedClasses, selectedStudents } = req.body;
        const organizationId = req.session.organizationId;

        if (!schoolYearId || !termId || !selectedClasses || !selectedStudents) {
            req.flash('error', 'School year, term, classes, and students are required for enrollment.');
            return res.status(400).json({ success: false, message: 'School year, term, classes, and students are required for enrollment.' });
        }

        try {
            await db.query('BEGIN');

            // Check if an enrollment already exists for the selected term, school year, and organization
            const existingEnrollmentResult = await db.query(`
                SELECT enrollment_id
                FROM enrollments
                WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3
            `, [schoolYearId, termId, organizationId]);

            if (existingEnrollmentResult.rows.length > 0) {
                req.flash('error', 'Enrollment already exists for this term. Please check the modify page to make changes.');
                await db.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Enrollment already exists for this term. Please check the modify page to make changes' });
            }

            // Insert a new enrollment entry
            const enrollmentResult = await db.query(`
                INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
                VALUES ($1, $2, $3, NOW())
                RETURNING enrollment_id
            `, [schoolYearId, termId, organizationId]);

            const enrollmentId = enrollmentResult.rows[0].enrollment_id;

            // Insert enrolled classes for the current enrollment
            await db.query(`
                INSERT INTO enrolled_classes (enrollment_id, class_id)
                SELECT $1, unnest($2::int[])
            `, [enrollmentId, selectedClasses]);

            // Insert enrolled students for each selected student
            for (const studentId of selectedStudents) {
                // Find the class ID associated with this student
                const classId = req.body[`classId_${studentId}`] || selectedClasses[0]; // Use selected class if not specified

                if (classId) {
                    await db.query(`
                        INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                        VALUES ($1, $2, $3)
                    `, [enrollmentId, studentId, classId]);
                }
            }

            await db.query('COMMIT');
            req.flash('success', 'Students enrolled successfully.');
            res.status(200).json({ success: true, message: 'Students enrolled successfully.' });
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error enrolling students:', error);
            req.flash('error', 'Failed to enroll students.');
            res.status(500).json({ success: false, message: 'Failed to enroll students.' });
        }
    },

    getStudentsByClass: async (req, res, db) => {
        const { classId } = req.query;

        try {
            const studentsResult = await db.query(`
                SELECT student_id, first_name, last_name
                FROM students
                WHERE class_id = $1
                ORDER BY last_name, first_name
            `, [classId]);

            res.json({ students: studentsResult.rows });
        } catch (error) {
            console.error('Error fetching students:', error);
            res.status(500).json({ error: 'Failed to fetch students.' });
        }
    }
};

module.exports = enrollmentController;
