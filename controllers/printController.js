const printController = (db) => ({
    
    printStudentReport: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            const getOrdinalSuffix = (i) => {
                const j = i % 10, k = i % 100;
                if (j == 1 && k != 11) return i + "st";
                if (j == 2 && k != 12) return i + "nd";
                if (j == 3 && k != 13) return i + "rd";
                return i + "th";
            };

            // Fetch class details
            const classResult = await db.query(
                'SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2',
                [classId, organizationId]
            );
            const classData = classResult.rows[0];
            if (!classData) {
                throw new Error('Class not found for the given class ID and organization ID.');
            }

            // Fetch organization details including logo URL
            const organizationResult = await db.query(
                'SELECT organization_name, organization_address, logo FROM organizations WHERE organization_id = $1',
                [organizationId]
            );
            const organization = organizationResult.rows[0];
            if (!organization) {
                throw new Error('Organization not found');
            }

            // Fetch students by class
            const studentsResult = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name, s.image_url, c.class_name
                FROM students s
                JOIN classes c ON s.class_id = c.class_id
                WHERE s.class_id = $1 AND s.organization_id = $2
            `, [classId, organizationId]);

            const students = studentsResult.rows;

            // Fetch all subjects for the class
            const subjectsResult = await db.query(`
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
            `, [classId, organizationId]);
            const allSubjects = subjectsResult.rows;

            // Process each student
            for (const student of students) {
                student.subjects = [];

                // For each subject, calculate the scores
                for (const subject of allSubjects) {
                    const scoresResult = await db.query(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN a.category = 'Class Assessment' THEN ar.score ELSE 0 END), 0) AS classAssessmentScore,
                            COALESCE(SUM(CASE WHEN a.category = 'Exams Assessment' THEN ar.score ELSE 0 END), 0) AS examsAssessmentScore,
                            COALESCE(SUM(CASE WHEN a.category = 'Other' THEN ar.score ELSE 0 END), 0) AS otherAssessmentScore,
                            COALESCE(SUM(ar.score), 0) AS totalScore,
                            COALESCE(SUM(ar.score * a.weight / 100), 0) AS weightedScore,
                            COALESCE(SUM(a.max_score * a.weight / 100), 0) AS weightedMaxScore,
                            sp.position, 
                            ar.grade
                        FROM assessments a
                        LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
                        LEFT JOIN student_positions sp ON sp.student_id = ar.student_id AND sp.subject_id = a.subject_id
                        WHERE a.subject_id = $2 AND a.class_id = $3 AND a.organization_id = $4
                        GROUP BY sp.position, ar.grade
                    `, [student.student_id, subject.subject_id, classId, organizationId]);

                    const subjectScores = scoresResult.rows[0] || {};
                    const totalPercentage = subjectScores.weightedMaxScore > 0 ? (subjectScores.weightedScore / subjectScores.weightedMaxScore) * 100 : 0;

                    student.subjects.push({
                        subject_name: subject.subject_name,
                        classAssessmentScore: subjectScores.classAssessmentScore || '-',
                        examsAssessmentScore: subjectScores.examsAssessmentScore || '-',
                        otherAssessmentScore: subjectScores.otherAssessmentScore || '-',
                        totalScore: subjectScores.totalScore || '-',
                        totalPercentage: totalPercentage !== 0 ? totalPercentage.toFixed(2) : '-',
                        grade: subjectScores.grade || '-',
                        position: subjectScores.position !== null ? getOrdinalSuffix(subjectScores.position) : '-',
                    });
                }
            }

            // Render the report page
            res.render('print/printStudentReport', {
                title: 'Student Final Report',
                class: classData,
                students: students,
                orgName: organization.organization_name || 'Default School Name',
                orgAddress: organization.organization_address,
                logoUrl: organization.logo,
                date: new Date().toLocaleDateString(),
                teacherRemarks: [], // Add actual remarks if available
                term: {}, // Add actual term data if available
                signatureImageUrl: '', // Add signature image URL if available
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
                teacher_remarks: [],
                signature_image_url: ''
            };

            res.render('print/remarks', {
                title: 'Manage Remarks',
                settings: settings,
                classes: classes,
                signatureImageUrl: settings.signature_image_url,
                success_msg: req.query.success === 'true' ? 'Signature image uploaded successfully!' : '',
                error_msg: ''
            });
        } catch (error) {
            console.error('Error fetching remarks:', error);
            res.render('print/remarks', {
                title: 'Manage Remarks',
                settings: {},
                classes: [],
                signatureImageUrl: '',
                success_msg: '',
                error_msg: 'Failed to fetch remarks.'
            });
        }
    },

    saveRemarks: async (req, res) => {
        const { cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, scoreRemarks, teacherRemarks } = req.body;
        const organizationId = req.session.organizationId;
        const signatureImageUrl = req.file ? req.file.path : null;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            // Save or update the report settings
            await db.query(`
                INSERT INTO report_settings (organization_id, cut_off_point, promoted_class, repeated_class, school_reopen_date, score_remark, teacher_remarks, signature_image_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (organization_id) DO UPDATE
                SET cut_off_point = EXCLUDED.cut_off_point,
                    promoted_class = EXCLUDED.promoted_class,
                    repeated_class = EXCLUDED.repeated_class,
                    school_reopen_date = EXCLUDED.school_reopen_date,
                    score_remark = EXCLUDED.score_remark,
                    teacher_remarks = EXCLUDED.teacher_remarks,
                    signature_image_url = EXCLUDED.signature_image_url
            `, [organizationId, cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, scoreRemarks, teacherRemarks, signatureImageUrl]);

            res.redirect('/print/remarks?success=true');
        } catch (error) {
            console.error('Error saving remarks:', error);
            res.redirect('/print/remarks?error=true');
        }
    },

    uploadSignatureImage: async (req, res) => {
        const organizationId = req.session.organizationId;
        const signatureImageUrl = req.file ? req.file.path : null;

        try {
            if (!organizationId) {
                throw new Error('Organization ID is not set in session.');
            }

            await db.query(`
                UPDATE report_settings
                SET signature_image_url = $1
                WHERE organization_id = $2
            `, [signatureImageUrl, organizationId]);

            res.redirect('/print/remarks?success=true');
        } catch (error) {
            console.error('Error uploading signature image:', error);
            res.redirect('/print/remarks?error=true');
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
