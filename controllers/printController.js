const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require('../config/s3');
const path = require('path');

// Helper functions for S3 actions
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

async function getFromS3(key) {
    try {
        // Return the full URL to the image in S3 (public access assumed)
        return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
    } catch (error) {
        console.error('Error fetching image from S3:', error);
        throw new Error('Could not retrieve image from S3.');
    }
}

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

const assignScoreRemark = async (percentage, organizationId, db) => {
    // Ensure we are comparing percentage as numeric
    const remarkResult = await db.query(`
        SELECT remark FROM score_remarks
        WHERE organization_id = $1
        AND $2::numeric BETWEEN from_percentage AND to_percentage
        LIMIT 1
    `, [organizationId, percentage]);

    return remarkResult.rows[0] ? remarkResult.rows[0].remark : 'No Remarks';
};

const printController = (db) => ({
    printStudentReport: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;
    
        try {
            if (!organizationId) {
                return res.status(400).send('Organization ID is not set in session.');
            }
    
            const getOrdinalSuffix = (i) => {
                const j = i % 10, k = i % 100;
                if (j === 1 && k !== 11) return i + "st";
                if (j === 2 && k !== 12) return i + "nd";
                if (j === 3 && k !== 13) return i + "rd";
                return i + "th";
            };
    
            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2', [classId, organizationId]);
            const classData = classResult.rows[0];
            if (!classData) {
                return res.status(404).send('Class not found for the given class ID and organization ID.');
            }
    
            // Fetch organization details
            const organizationResult = await db.query('SELECT organization_name, organization_address, logo_path FROM organizations WHERE organization_id = $1', [organizationId]);
            const organization = organizationResult.rows[0];
            if (!organization) {
                return res.status(404).send('Organization not found.');
            }
    
            // Fetch status settings
            const statusSettingsResult = await db.query(`
                SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion
                FROM status_settings
                WHERE organization_id = $1 LIMIT 1
            `, [organizationId]);
            const statusSettings = statusSettingsResult.rows[0];
    
            const cutOffPoint = statusSettings.cut_off_point || 0;
            const promotedClass = statusSettings.promoted_class || 'N/A';
            const repeatedClass = statusSettings.repeated_class || 'N/A';
            const activatePromotion = statusSettings.activate_promotion;
            const schoolReopenDate = statusSettings.school_reopen_date ? new Date(statusSettings.school_reopen_date).toLocaleDateString() : 'TBA';
    
            // Fetch students and their subjects
            const studentsResult = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name, s.image_url, c.class_name
                FROM students s
                JOIN classes c ON s.class_id = c.class_id
                WHERE s.class_id = $1 AND s.organization_id = $2
            `, [classId, organizationId]);
            const students = studentsResult.rows;
    
            const subjectsResult = await db.query(`
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
            `, [classId, organizationId]);
            const allSubjects = subjectsResult.rows;
    
            const teacherRemarksResult = await db.query('SELECT id, remark FROM teacher_remarks WHERE organization_id = $1', [organizationId]);
            const teacherRemarks = teacherRemarksResult.rows;
    
            // Fetch signature
            const reportSettingsResult = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1', [organizationId]);
            const signatureImagePath = reportSettingsResult.rows[0]?.signature_image_path;
            const signatureImageUrl = signatureImagePath ? await getFromS3(signatureImagePath) : null;
    
            let studentScores = [];
    
            for (const student of students) {
                student.subjects = [];
                let totalPercentageSum = 0;
                let totalScoreSum = 0;
                let subjectCount = 0;
    
                for (const subject of allSubjects) {
                    // Fetch category scores from the category_scores table for each category
                    const categoryScoresResult = await db.query(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN cs.category = 'Class Assessment' THEN cs.total_score ELSE 0 END), 0) AS classAssessmentScore,
                            COALESCE(SUM(CASE WHEN cs.category = 'Exams Assessment' THEN cs.total_score ELSE 0 END), 0) AS examsAssessmentScore,
                            COALESCE(SUM(CASE WHEN cs.category = 'Other' THEN cs.total_score ELSE 0 END), 0) AS otherAssessmentScore
                        FROM category_scores cs
                        WHERE cs.student_id = $1 AND cs.subject_id = $2 AND cs.class_id = $3 AND cs.organization_id = $4
                    `, [student.student_id, subject.subject_id, classId, organizationId]);
    
                    const categoryScores = categoryScoresResult.rows[0] || {};
    
                    const classAssessmentScore = categoryScores.classassessmentscore || '-';
                    const examsAssessmentScore = categoryScores.examsassessmentscore || '-';
                    const otherAssessmentScore = categoryScores.otherassessmentscore || '-';
    
                    // Log for debugging purposes
                    console.log(`Category Scores for Student ID ${student.student_id}, Subject ID ${subject.subject_id}:`, categoryScores);
    
                    const scoresResult = await db.query(`
                        SELECT 
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
                    const totalScore = parseFloat(subjectScores.total_subject_score) || 0;
                    const totalPercentage = parseFloat(subjectScores.total_percentage) || null;
    
                    const scoreRemark = totalPercentage
                        ? await assignScoreRemark(totalPercentage, organizationId, db)
                        : 'No Remarks';
    
                    if (totalPercentage) {
                        totalPercentageSum += totalPercentage;
                        subjectCount++;
                    }
    
                    totalScoreSum += totalScore;
    
                    student.subjects.push({
                        subject_name: subject.subject_name,
                        classAssessmentScore: classAssessmentScore !== '-' ? parseFloat(classAssessmentScore).toFixed(2) : '-',
                        examsAssessmentScore: examsAssessmentScore !== '-' ? parseFloat(examsAssessmentScore).toFixed(2) : '-',
                        otherAssessmentScore: otherAssessmentScore !== '-' ? parseFloat(otherAssessmentScore).toFixed(2) : '-',
                        totalScore: totalScore.toFixed(2),
                        totalPercentage: totalPercentage !== null ? totalPercentage.toFixed(2) : '-',
                        grade: subjectScores.grade || '-',
                        position: subjectScores.position ? getOrdinalSuffix(subjectScores.position) : '-',
                        remarks: scoreRemark || 'No Remarks',
                    });
                }
    
                student.overallPercentage = subjectCount > 0 ? (totalPercentageSum / subjectCount).toFixed(2) : '-';
                student.totalScoreSum = totalScoreSum;
    
                if (student.overallPercentage >= cutOffPoint) {
                    student.promotionStatus = 'Promoted';
                    student.promotionClass = promotedClass;
                } else {
                    student.promotionStatus = 'Repeated';
                    student.promotionClass = repeatedClass;
                }
    
                studentScores.push({
                    student_id: student.student_id,
                    first_name: student.first_name,
                    last_name: student.last_name,
                    totalScoreSum: student.totalScoreSum
                });
            }
    
            studentScores.sort((a, b) => b.totalScoreSum - a.totalScoreSum);
    
            studentScores.forEach((studentScore, index) => {
                const student = students.find(s => s.student_id === studentScore.student_id);
                student.positionInClass = getOrdinalSuffix(index + 1);
            });
    
            const logoUrl = organization.logo_path ? await getFromS3(organization.logo_path) : null;
    
            const termResult = await db.query('SELECT * FROM terms WHERE organization_id = $1 AND current = true LIMIT 1', [organizationId]);
            const term = termResult.rows[0] || null;
    
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
                schoolReopenDate: schoolReopenDate,
                promotedClass: promotedClass,
                repeatedClass: repeatedClass,
                activatePromotion: activatePromotion
            });
        } catch (error) {
            console.error('Error generating student report:', error);
            res.status(500).send('Failed to generate student report.');
        }
    },
    
    
    
    
    
    
        
    
    reportSettingsPage: async (req, res) => {
        const organizationId = req.session.organizationId;

        try {
            // Fetch status settings
            const statusResult = await db.query('SELECT * FROM status_settings WHERE organization_id = $1 LIMIT 1', [organizationId]);
            const statusSettings = statusResult.rows[0] || {};

            // Fetch classes for the organization
            const classesResult = await db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1', [organizationId]);
            const classes = classesResult.rows || [];

            // Fetch teacher remarks
            const teacherRemarksResult = await db.query('SELECT * FROM teacher_remarks WHERE organization_id = $1', [organizationId]);
            const teacherRemarks = teacherRemarksResult.rows || [];

            // Fetch score remarks
            const scoreRemarksResult = await db.query('SELECT * FROM score_remarks WHERE organization_id = $1', [organizationId]);
            const scoreRemarks = scoreRemarksResult.rows || [];

            // Fetch existing signature image URL if available
            const reportSettingsResult = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1', [organizationId]);
            const reportSettings = reportSettingsResult.rows[0];
            let signatureImageUrl = null;

            if (reportSettings && reportSettings.signature_image_path) {
                signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
            }

            res.render('print/reportSettings', {
                title: 'Report Settings',
                statusSettings,
                teacherRemarks,
                scoreRemarks,
                classes, // Pass the class data to the view
                signatureImageUrl, 
                success_msg: req.flash('success_msg'),
                error_msg: req.flash('error_msg'),
            });
        } catch (error) {
            console.error('Error rendering report settings page:', error);
            res.status(500).send('Failed to load report settings page.');
        }
    },

    
    updateReportSettings: async (req, res) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;
        const { schoolReopenDate, activatePromotion } = req.body;
    
        try {
            const activatePromotionStatus = activatePromotion === 'on'; // If checked, this will be 'on'
    
            await db.query(`
                UPDATE status_settings 
                SET school_reopen_date = $1, activate_promotion = $2 
                WHERE organization_id = $3 AND class_id = $4
            `, [schoolReopenDate, activatePromotionStatus, organizationId, classId]);
    
            req.flash('success', 'Settings updated successfully');
            res.redirect(`/print/reportSettings?classId=${classId}`);
        } catch (error) {
            console.error('Error updating report settings:', error);
            req.flash('error', 'Failed to update settings.');
            res.redirect(`/print/reportSettings?classId=${classId}`);
        }
    },
    

    savePromotionSettings: async (req, res) => {
        const { cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, activatePromotion } = req.body;
        const organizationId = req.session.organizationId;
    
        try {
            if (!organizationId) {
                return res.status(400).send('Organization ID is not set in session.');
            }
    
            // If schoolReopenDate is an empty string, set it to null
            const reopenDate = schoolReopenDate === "" ? null : schoolReopenDate;
    
            // Insert or update the status settings in the database
            await db.query(`
                INSERT INTO status_settings (organization_id, cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (organization_id)
                DO UPDATE SET 
                    cut_off_point = EXCLUDED.cut_off_point,
                    promoted_class = EXCLUDED.promoted_class,
                    repeated_class = EXCLUDED.repeated_class,
                    school_reopen_date = EXCLUDED.school_reopen_date,
                    activate_promotion = EXCLUDED.activate_promotion
            `, [organizationId, cutOffPoint, promotedClass, repeatedClass, reopenDate, activatePromotion === "on"]);
    
            res.redirect(`/print/reportSettings?classId=${req.query.classId}`);
        } catch (error) {
            console.error('Error saving promotion settings:', error);
            res.status(500).send('Error saving promotion settings.');
        }
    },
    

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

    saveScoreRemarks: async (req, res) => {
        const { remark, from_percentage, to_percentage } = req.body;
        const organizationId = req.session.organizationId;

        try {
            await db.query(`
                INSERT INTO score_remarks (organization_id, remark, from_percentage, to_percentage)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (organization_id, remark) DO UPDATE
                SET from_percentage = EXCLUDED.from_percentage, to_percentage = EXCLUDED.to_percentage
            `, [organizationId, remark, from_percentage, to_percentage]);

            req.flash('success_msg', 'Score remarks saved successfully.');
            res.redirect('/print/reportSettings');
        } catch (error) {
            console.error('Error saving score remarks:', error);
            req.flash('error_msg', 'Failed to save score remarks.');
            res.redirect('/print/reportSettings');
        }
    },

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

    uploadSignatureImage: async (req, res) => {
        const { file } = req;
        const organizationId = req.session.organizationId;
    
        if (!file) {
            req.flash('error_msg', 'No file uploaded.');
            return res.redirect('/print/reportSettings');
        }
    
        try {
            // Check if there's already an image in S3
            const result = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1', [organizationId]);
            const currentImagePath = result.rows[0]?.signature_image_path;
    
            // If there's an existing image, delete it from S3
            if (currentImagePath) {
                await deleteFromS3(currentImagePath);
            }
    
            // Generate a new key for the file in S3
            const key = `signatures/${organizationId}/${Date.now()}_${file.originalname}`;
    
            // Upload the new image to S3
            const uploadedKey = await uploadToS3(key, file);
    
            // Update the database with the new image path
            if (result.rows.length > 0) {
                await db.query('UPDATE report_settings SET signature_image_path = $1 WHERE organization_id = $2', [uploadedKey, organizationId]);
            } else {
                await db.query('INSERT INTO report_settings (organization_id, signature_image_path) VALUES ($1, $2)', [organizationId, uploadedKey]);
            }
    
            req.flash('success_msg', 'Signature image uploaded successfully.');
            res.redirect('/print/reportSettings');
        } catch (error) {
            console.error('Error uploading signature image:', error);
            req.flash('error_msg', 'Failed to upload signature image.');
            res.redirect('/print/reportSettings');
        }
    },
                
    deleteSignatureImage: async (req, res) => {
        const organizationId = req.session.organizationId;
    
        try {
            // Get the current image path from the database
            const result = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1', [organizationId]);
            const signatureImagePath = result.rows[0]?.signature_image_path;
    
            // If there is an image, delete it from S3
            if (signatureImagePath) {
                await deleteFromS3(signatureImagePath);
            }
    
            // Remove the image path from the database
            await db.query('UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1', [organizationId]);
    
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
