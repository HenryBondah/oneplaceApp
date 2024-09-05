const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3Client } = require('../config/s3');
const path = require('path');

// Helper function to upload file to S3 using PutObjectCommand
async function uploadToS3(key, file) {
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
    });

    try {
        await s3Client.send(command);
        return key;
    } catch (error) {
        console.error('Error uploading to S3:', error);
        throw new Error('Could not upload file to S3.');
    }
}

// Helper function to get file from S3
async function getFromS3(key) {
    const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
    });

    try {
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return url;
    } catch (error) {
        console.error('Error fetching from S3:', error);
        throw new Error('Could not retrieve file from S3.');
    }
}

// Helper function to delete file from S3
async function deleteFromS3(key) {
    const command = new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
    });

    try {
        await s3Client.send(command);
    } catch (error) {
        console.error('Error deleting from S3:', error);
        throw new Error('Could not delete file from S3.');
    }
}
        
        const printController = (db) => ({
            printStudentReport: async (req, res) => {
                const { classId } = req.query; // Get classId from query parameters
                const organizationId = req.session.organizationId; // Get organizationId from session
            
                try {
                    if (!organizationId) {
                        return res.status(400).send('Organization ID is not set in session.');
                    }
            
                    // Helper function to add ordinal suffix to positions
                    const getOrdinalSuffix = (i) => {
                        const j = i % 10, k = i % 100;
                        if (j === 1 && k !== 11) return i + "st";
                        if (j === 2 && k !== 12) return i + "nd";
                        if (j === 3 && k !== 13) return i + "rd";
                        return i + "th";
                    };
            
                    // Fetch class data
                    const classResult = await db.query(
                        'SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2',
                        [classId, organizationId]
                    );
                    const classData = classResult.rows[0];
                    if (!classData) {
                        return res.status(404).send('Class not found for the given class ID and organization ID.');
                    }
            
                    // Fetch organization data
                    const organizationResult = await db.query(
                        'SELECT organization_name, organization_address, logo_path FROM organizations WHERE organization_id = $1',
                        [organizationId]
                    );
                    const organization = organizationResult.rows[0];
                    if (!organization) {
                        return res.status(404).send('Organization not found.');
                    }
            
                    // Fetch students in the class
                    const studentsResult = await db.query(`
                        SELECT s.student_id, s.first_name, s.last_name, s.image_url, c.class_name
                        FROM students s
                        JOIN classes c ON s.class_id = c.class_id
                        WHERE s.class_id = $1 AND s.organization_id = $2
                    `, [classId, organizationId]);
                    const students = studentsResult.rows;
            
                    // Fetch subjects for the class
                    const subjectsResult = await db.query(`
                        SELECT subject_id, subject_name
                        FROM subjects
                        WHERE class_id = $1 AND organization_id = $2
                    `, [classId, organizationId]);
                    const allSubjects = subjectsResult.rows;
            
                    // Fetch teacher remarks for the specific organization
                    const teacherRemarksResult = await db.query(
                        'SELECT id, remark FROM teacher_remarks WHERE organization_id = $1',
                        [organizationId]
                    );
                    const teacherRemarks = teacherRemarksResult.rows;
            
                    // Fetch status settings, including school reopen date
                    const statusSettingsResult = await db.query(
                        'SELECT school_reopen_date FROM status_settings WHERE organization_id = $1 LIMIT 1',
                        [organizationId]
                    );
                    const statusSettings = statusSettingsResult.rows[0];
                    const schoolReopenDate = statusSettings ? statusSettings.school_reopen_date : null;
            
                    // Process each student and fetch their scores
                    for (const student of students) {
                        student.subjects = [];
                        const categoryTotals = {
                            'Class Assessment': 0,
                            'Exams Assessment': 0,
                            'Other': 0,
                        };
            
                        for (const subject of allSubjects) {
                            const scoresResult = await db.query(`
                                SELECT 
                                    COALESCE(SUM(CASE WHEN ar.category = 'Class Assessment' THEN ar.score ELSE 0 END), 0) AS classAssessmentScore,
                                    COALESCE(SUM(CASE WHEN ar.category = 'Exams Assessment' THEN ar.score ELSE 0 END), 0) AS examsAssessmentScore,
                                    COALESCE(SUM(CASE WHEN ar.category = 'Other' THEN ar.score ELSE 0 END), 0) AS otherAssessmentScore,
                                    COALESCE(SUM(ar.score), 0) AS totalScore,
                                    ar.total_subject_score,
                                    ar.total_percentage,
                                    sp.position, 
                                    ar.grade
                                FROM assessments a
                                LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
                                LEFT JOIN student_positions sp ON sp.student_id = ar.student_id AND sp.subject_id = a.subject_id
                                WHERE a.subject_id = $2 AND a.class_id = $3 AND a.organization_id = $4
                                GROUP BY ar.total_subject_score, ar.total_percentage, sp.position, ar.grade
                            `, [student.student_id, subject.subject_id, classId, organizationId]);
            
                            const subjectScores = scoresResult.rows[0] || {};
            
                            categoryTotals['Class Assessment'] += parseFloat(subjectScores.classAssessmentScore || 0);
                            categoryTotals['Exams Assessment'] += parseFloat(subjectScores.examsAssessmentScore || 0);
                            categoryTotals['Other'] += parseFloat(subjectScores.otherAssessmentScore || 0);
            
                            const totalScore = subjectScores.total_subject_score !== null && subjectScores.total_subject_score !== undefined 
                                ? parseFloat(subjectScores.total_subject_score) 
                                : null;
                            const totalPercentage = subjectScores.total_percentage !== null && subjectScores.total_percentage !== undefined 
                                ? parseFloat(subjectScores.total_percentage) 
                                : null;
            
                            student.subjects.push({
                                subject_name: subject.subject_name,
                                totalScore: totalScore !== null ? totalScore.toFixed(2) : '-',
                                totalPercentage: totalPercentage !== null ? totalPercentage.toFixed(2) : '-',
                                grade: subjectScores.grade || '-',
                                position: subjectScores.position !== null ? getOrdinalSuffix(subjectScores.position) : '-',
                                classAssessmentScore: subjectScores.classAssessmentScore !== undefined && subjectScores.classAssessmentScore !== 0 
                                    ? subjectScores.classAssessmentScore.toFixed(2) 
                                    : '-',
                                examsAssessmentScore: subjectScores.examsAssessmentScore !== undefined && subjectScores.examsAssessmentScore !== 0 
                                    ? subjectScores.examsAssessmentScore.toFixed(2) 
                                    : '-',
                                otherAssessmentScore: subjectScores.otherAssessmentScore !== undefined && subjectScores.otherAssessmentScore !== 0 
                                    ? subjectScores.otherAssessmentScore.toFixed(2) 
                                    : '-',
                            });
                        }
            
                        for (const [category, total] of Object.entries(categoryTotals)) {
                            await db.query(`
                                INSERT INTO category_scores (student_id, class_id, subject_id, category, total_score, organization_id)
                                VALUES ($1, $2, NULL, $3, $4, $5)
                                ON CONFLICT (student_id, class_id, category, organization_id)
                                DO UPDATE SET total_score = EXCLUDED.total_score
                            `, [student.student_id, classId, category, total, organizationId]);
                        }
                    }
            
                    // Fetch organization logo from S3
                    let logoUrl = null;
                    if (organization.logo_path) {
                        logoUrl = await getFromS3(organization.logo_path);
                    }
            
                    // Fetch signature image from S3
                    let signatureImageUrl = await getFromS3('signatures/signature.png');
            
                    // Fetch current term details
                    const termResult = await db.query(
                        'SELECT * FROM terms WHERE organization_id = $1 AND current = true LIMIT 1',
                        [organizationId]
                    );
                    const term = termResult.rows[0] || null;  // Add fallback to handle the missing term
            
                    // Render the report page with all data, including classId, teacherRemarks, and schoolReopenDate
                    res.render('print/printStudentReport', {
                        title: 'Student Final Report',
                        students: students,
                        orgName: organization.organization_name || 'Default School Name',
                        orgAddress: organization.organization_address,
                        logoUrl: logoUrl,  
                        signatureImageUrl: signatureImageUrl,  
                        term: term,
                        teacherRemarks: teacherRemarks,  
                        classId: classId,
                        schoolReopenDate: schoolReopenDate // Passing schoolReopenDate to the template
                    });
                    
                } catch (error) {
                    console.error('Error generating student report:', error);
                    res.status(500).send('Failed to generate student report.');
                }
            },
            
                        
            
            
                
        reportSettingsPage: async (req, res) => {
            const organizationId = req.session.organizationId;
            const classId = req.query.classId; // Assuming it's passed in the query or session
        
            try {
                // Fetch status settings
                const statusResult = await db.query('SELECT * FROM status_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
                const statusSettings = statusResult.rows[0] || {};
        
                // Fetch teacher remarks
                const teacherRemarksResult = await db.query('SELECT * FROM teacher_remarks WHERE organization_id = $1', [organizationId]);
                const teacherRemarks = teacherRemarksResult.rows || [];
        
                // Fetch score remarks
                const scoreRemarksResult = await db.query('SELECT * FROM score_remarks WHERE organization_id = $1', [organizationId]);
                const scoreRemarks = scoreRemarksResult.rows || [];
        
                // Fetch signature image from S3 if exists
                let signatureImageUrl = null;
                const reportSettingsResult = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
                const reportSettings = reportSettingsResult.rows[0];
                if (reportSettings && reportSettings.signature_image_path) {
                    signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
                }
        
                res.render('print/reportSettings', {
                    title: 'Report Settings',
                    statusSettings,
                    teacherRemarks,
                    scoreRemarks,
                    signatureImageUrl, // Pass the signature URL to the view
                    classId, // Ensure that classId is passed to the view
                    success_msg: req.flash('success_msg'),
                    error_msg: req.flash('error_msg'),
                });
            } catch (error) {
                console.error('Error rendering report settings page:', error);
                res.status(500).send('Failed to load report settings page.');
            }
        },
            
        // Save promotion settings (status settings)
        savePromotionSettings: async (req, res) => {
            const { cutOffPoint, promotedClass, repeatedClass, schoolReopenDate } = req.body;
            const organizationId = req.session.organizationId;
    
            try {
                await db.query(`
                    INSERT INTO status_settings (organization_id, cut_off_point, promoted_class, repeated_class, school_reopen_date)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (organization_id) DO UPDATE
                    SET cut_off_point = EXCLUDED.cut_off_point,
                        promoted_class = EXCLUDED.promoted_class,
                        repeated_class = EXCLUDED.repeated_class,
                        school_reopen_date = EXCLUDED.school_reopen_date
                `, [organizationId, cutOffPoint, promotedClass, repeatedClass, schoolReopenDate]);
    
                req.flash('success_msg', 'Status settings saved successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                console.error('Error saving promotion settings:', error);
                req.flash('error_msg', 'Failed to save status settings.');
                res.redirect('/print/reportSettings');
            }
        },
    
        // Save teacher remarks
        saveTeacherRemarks: async (req, res) => {
            const { teacherRemarks } = req.body;
            const organizationId = req.session.organizationId;
    
            try {
                await db.query('INSERT INTO teacher_remarks (organization_id, remark) VALUES ($1, $2)', [organizationId, teacherRemarks]);
                req.flash('success_msg', 'Teacher remarks saved successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                console.error('Error saving teacher remarks:', error);
                req.flash('error_msg', 'Failed to save teacher remarks.');
                res.redirect('/print/reportSettings');
            }
        },
    
        // Delete teacher remark
        deleteTeacherRemark: async (req, res) => {
            const { id } = req.params;
            try {
                await db.query('DELETE FROM teacher_remarks WHERE id = $1', [id]);
                req.flash('success_msg', 'Teacher remark deleted successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                req.flash('error_msg', 'Error deleting teacher remark.');
                res.redirect('/print/reportSettings');
            }
        },
    
        // Save score remarks
        saveScoreRemarks: async (req, res) => {
            const { scoreRemarks } = req.body;
            const organizationId = req.session.organizationId;
    
            try {
                await db.query('INSERT INTO score_remarks (organization_id, remark) VALUES ($1, $2)', [organizationId, scoreRemarks]);
                req.flash('success_msg', 'Score remarks saved successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                console.error('Error saving score remarks:', error);
                req.flash('error_msg', 'Failed to save score remarks.');
                res.redirect('/print/reportSettings');
            }
        },
    
        // Delete score remark
        deleteScoreRemark: async (req, res) => {
            const { id } = req.params;
            try {
                await db.query('DELETE FROM score_remarks WHERE id = $1', [id]);
                req.flash('success_msg', 'Score remark deleted successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                req.flash('error_msg', 'Error deleting score remark.');
                res.redirect('/print/reportSettings');
            }
        },

        // Upload signature image
        uploadSignatureImage: async (req, res) => {
            const { file } = req;
            const organizationId = req.session.organizationId;
    
            if (!file) {
                req.flash('error_msg', 'No file uploaded.');
                return res.redirect('/print/reportSettings');
            }
    
            try {
                const key = `signatures/signature_${organizationId}${path.extname(file.originalname)}`;
    
                // Upload the new signature to S3
                await uploadToS3(key, file);
    
                // Store the new signature image path in the database
                await db.query(`
                    INSERT INTO report_settings (organization_id, signature_image_path)
                    VALUES ($1, $2)
                    ON CONFLICT (organization_id) DO UPDATE
                    SET signature_image_path = EXCLUDED.signature_image_path
                `, [organizationId, key]);
    
                req.flash('success_msg', 'Signature image uploaded successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                console.error('Error uploading signature image:', error);
                req.flash('error_msg', 'Failed to upload signature image.');
                res.redirect('/print/reportSettings');
            }
        },
    
        // Delete signature image
        deleteSignatureImage: async (req, res) => {
            const organizationId = req.session.organizationId;
    
            try {
                const settingsResult = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
                const signatureImagePath = settingsResult.rows[0]?.signature_image_path;
    
                if (signatureImagePath) {
                    await deleteFromS3(signatureImagePath);
    
                    // Remove the image path from the database
                    await db.query(`
                        UPDATE report_settings
                        SET signature_image_path = NULL
                        WHERE organization_id = $1
                    `, [organizationId]);
                }
    
                req.flash('success_msg', 'Signature image deleted successfully.');
                res.redirect('/print/reportSettings');
            } catch (error) {
                console.error('Error deleting signature image:', error);
                req.flash('error_msg', 'Failed to delete signature image.');
                res.redirect('/print/reportSettings');
            }
        }
    });
    
    module.exports = printController;
    