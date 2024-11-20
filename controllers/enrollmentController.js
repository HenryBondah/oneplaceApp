const enrollmentController = {
    // Enrollment page
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
    },

manageEnrollmentGet: async (req, res, db) => {
    try {
        const organizationId = req.session.organizationId;

        // Fetch all enrollments along with classes and students
        const enrollmentsResult = await db.query(`
            SELECT e.enrollment_id, sy.year_label as school_year, sy.current as is_current_year, t.term_name as term, t.current as is_current_term
            FROM enrollments e
            INNER JOIN school_years sy ON e.school_year_id = sy.id
            INNER JOIN terms t ON e.term_id = t.term_id
            WHERE e.organization_id = $1
            ORDER BY sy.current DESC, sy.year_label, t.term_name
        `, [organizationId]);

        const enrollments = enrollmentsResult.rows;

        for (const enrollment of enrollments) {
            // Fetch classes for the enrollment
            const classesResult = await db.query(`
                SELECT c.class_id, c.class_name
                FROM enrolled_classes ec
                INNER JOIN classes c ON ec.class_id = c.class_id
                WHERE ec.enrollment_id = $1
            `, [enrollment.enrollment_id]);

            const classes = classesResult.rows;

            for (const cls of classes) {
                // Fetch all students for the organization
                const allStudentsResult = await db.query(`
                    SELECT student_id, first_name, last_name, class_id
                    FROM students
                    WHERE organization_id = $1
                    ORDER BY last_name, first_name
                `, [organizationId]);

                const allStudents = allStudentsResult.rows;

                // Fetch enrolled students for the specific class in the enrollment
                const enrolledStudentsResult = await db.query(`
                    SELECT s.student_id, s.first_name, s.last_name
                    FROM enrolled_students es
                    INNER JOIN students s ON es.student_id = s.student_id
                    WHERE es.enrollment_id = $1 AND es.class_id = $2
                    ORDER BY s.last_name, s.first_name
                `, [enrollment.enrollment_id, cls.class_id]);

                const enrolledStudents = enrolledStudentsResult.rows;

                // Assign all students and enrolled students to the class
                cls.all_students = allStudents.filter(student => student.class_id === cls.class_id);
                cls.enrolled_students = enrolledStudents;
            }

            enrollment.classes = classes;
        }

        res.render('enrollment/manageEnrollment', {
            title: 'Manage Enrollments',
            enrollments,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching enrollments:', error);
        req.flash('error', 'Failed to load enrollments.');
        res.redirect('/');
    }
},

        
    modifyEnrollmentGet: async (req, res, db) => {
        const enrollmentId = req.params.enrollmentId;
    
        try {
            const organizationId = req.session.organizationId;
    
            // Fetch enrollment details
            const enrollmentResult = await db.query(`
                SELECT e.enrollment_id, sy.year_label as school_year, t.term_name as term
                FROM enrollments e
                INNER JOIN school_years sy ON e.school_year_id = sy.id
                INNER JOIN terms t ON e.term_id = t.term_id
                WHERE e.enrollment_id = $1 AND e.organization_id = $2
            `, [enrollmentId, organizationId]);
    
            if (enrollmentResult.rows.length === 0) {
                req.flash('error', 'Enrollment not found.');
                return res.redirect('/enrollment/manageEnrollment');
            }
    
            const enrollment = enrollmentResult.rows[0];
    
            // Fetch all classes for modification
            const classesResult = await db.query(`
                SELECT class_id, class_name
                FROM classes
                WHERE organization_id = $1
            `, [organizationId]);
    
            // Fetch all students for modification
            const studentsResult = await db.query(`
                SELECT student_id, first_name, last_name, class_id
                FROM students
                WHERE organization_id = $1
                ORDER BY last_name, first_name
            `, [organizationId]);
    
            // Fetch existing classes and students for this enrollment
            const enrolledClassesResult = await db.query(`
                SELECT class_id
                FROM enrolled_classes
                WHERE enrollment_id = $1
            `, [enrollmentId]);
    
            const enrolledStudentsResult = await db.query(`
                SELECT student_id, class_id
                FROM enrolled_students
                WHERE enrollment_id = $1
            `, [enrollmentId]);
    
            // Attach class and student data to the enrollment object
            enrollment.classes = enrolledClassesResult.rows;
            enrollment.students = enrolledStudentsResult.rows.map(student => {
                const studentInfo = studentsResult.rows.find(s => s.student_id === student.student_id);
                return {
                    ...studentInfo,
                    class_id: student.class_id
                };
            });
    
            res.render('enrollment/modifyEnrollment', {
                title: 'Modify Enrollment',
                enrollment,
                classes: classesResult.rows,
                students: studentsResult.rows,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error fetching enrollment data for modification:', error);
            req.flash('error', 'Failed to load enrollment data.');
            res.redirect('/enrollment/manageEnrollment');
        }
    },
    
    deleteEnrollment: async (req, res, db) => {
        const enrollmentId = req.params.enrollmentId;

        try {
            await db.query('BEGIN');

            // Delete enrolled students
            await db.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete enrolled classes
            await db.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete the enrollment itself
            await db.query(`DELETE FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]);

            await db.query('COMMIT');
            req.flash('success', 'Enrollment deleted successfully.');
            res.redirect('/enrollment/manageEnrollment');
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error deleting enrollment:', error);
            req.flash('error', 'Failed to delete enrollment.');
            res.redirect('/enrollment/modifyEnrollment/' + enrollmentId);
        }
    },
    
    modifyEnrollmentPost: async (req, res, db) => {
        const enrollmentId = req.params.enrollmentId;
        const { selectedClasses, selectedStudents } = req.body;

        try {
            await db.query('BEGIN');

            // Update enrolled classes
            await db.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollmentId]);
            if (selectedClasses) {
                await db.query(`
                    INSERT INTO enrolled_classes (enrollment_id, class_id)
                    SELECT $1, unnest($2::int[])
                `, [enrollmentId, selectedClasses]);
            }

            // Update enrolled students
            await db.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollmentId]);
            if (selectedStudents) {
                for (const studentId of selectedStudents) {
                    await db.query(`
                        INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                        VALUES ($1, $2, (SELECT class_id FROM enrolled_classes WHERE enrollment_id = $1 LIMIT 1))
                    `, [enrollmentId, studentId]);
                }
            }

            await db.query('COMMIT');
            req.flash('success', 'Enrollment updated successfully.');
            res.redirect('/enrollment/manageEnrollment');
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error modifying enrollment:', error);
            req.flash('error', 'Failed to modify enrollment.');
            res.redirect('/enrollment/modifyEnrollment/' + enrollmentId);
        }
    }
};

module.exports = enrollmentController;
