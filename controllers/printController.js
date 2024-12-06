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

function getOrdinalSuffix(number) {
    const suffixes = ["th", "st", "nd", "rd"];
    const value = number % 100;
    return number + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
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
        const { classId, termId } = req.query;
        const organizationId = req.session.organizationId;

        if (!organizationId) {
            return res.status(400).send('Organization ID is not set in session.');
        }

        if (!classId || isNaN(classId)) {
            return res.status(400).send('Invalid or missing classId.');
        }

        if (!termId || isNaN(termId)) {
            return res.status(400).send('Invalid or missing termId.');
        }

        try {
            const parsedClassId = parseInt(classId, 10);
            const parsedTermId = parseInt(termId, 10);

            // Fetch organization details (Logo, Organization Name, Address)
            const organizationResult = await db.query('SELECT organization_name, organization_address, organization_phone, email, logo_path FROM organizations WHERE organization_id = $1', [organizationId]);
            const organization = organizationResult.rows[0];
            if (!organization) {
                return res.status(404).send('Organization not found.');
            }

            // Fetch logo without any dependency on class or term
            const logoUrl = organization.logo_path ? await getFromS3(organization.logo_path) : null;

            // Fetch class details
            const classResult = await db.query('SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2', [parsedClassId, organizationId]);
            const classData = classResult.rows[0];
            if (!classData) {
                return res.status(404).send('Class not found for the given class ID and organization ID.');
            }

            // Fetch status settings
            const statusSettingsResult = await db.query(`
                SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion, term_end_date
                FROM status_settings
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 LIMIT 1
            `, [organizationId, parsedClassId, parsedTermId]);
            const statusSettings = statusSettingsResult.rows[0] || {};

            const cutOffPoint = statusSettings.cut_off_point || 'No Cut-off Point Set';
            const promotedClassId = statusSettings.promoted_class || null;
            const repeatedClassId = statusSettings.repeated_class || null;
            const schoolReopenDate = statusSettings.school_reopen_date
                ? new Date(statusSettings.school_reopen_date).toLocaleDateString()
                : 'No Reopen Date';
            const activatePromotion = statusSettings.activate_promotion || false;

            // Use term_end_date from status_settings if available, otherwise fall back to term's end date
            let termEndDate = statusSettings.term_end_date ? new Date(statusSettings.term_end_date).toLocaleDateString() : null;

            // Fetch the actual names for promoted and repeated classes if they exist
            let promotedClassName = 'No Promoted Class';
            let repeatedClassName = 'No Repeated Class';

            if (promotedClassId) {
                const promotedClassResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [promotedClassId, organizationId]);
                promotedClassName = promotedClassResult.rows[0]?.class_name || promotedClassName;
            }

            if (repeatedClassId) {
                const repeatedClassResult = await db.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [repeatedClassId, organizationId]);
                repeatedClassName = repeatedClassResult.rows[0]?.class_name || repeatedClassName;
            }

            // Fetch term details including school year label
            const termResult = await db.query(`
                SELECT t.term_name, t.start_date, t.end_date, sy.year_label
                FROM terms t
                JOIN school_years sy ON t.school_year_id = sy.id
                WHERE t.term_id = $1 AND t.organization_id = $2
            `, [parsedTermId, organizationId]);
            const term = termResult.rows[0];
            if (!term) {
                return res.status(404).send('Term not found for the given term ID.');
            }

            const schoolYearLabel = term.year_label || 'No School Year Available';

            // If term_end_date is not set in status_settings, use term's end date
            if (!termEndDate) {
                termEndDate = term.end_date ? new Date(term.end_date).toLocaleDateString() : 'No End Date';
            }

            // Calculate the number of attendance days up to today
            const startDate = new Date(term.start_date);
            const endDate = new Date(term.end_date);
            const today = new Date();

            let totalDays = 0;
            let currentDate = new Date(startDate);

            while (currentDate <= endDate && currentDate <= today) {
                totalDays++;
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Fetch students and their subjects for the given term
            const studentsResult = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name, s.image_url, c.class_name
                FROM students s
                JOIN classes c ON s.class_id = c.class_id
                WHERE s.class_id = $1 AND s.organization_id = $2
            `, [parsedClassId, organizationId]);
            const students = studentsResult.rows;

            const subjectsResult = await db.query(`
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
            `, [parsedClassId, organizationId]);
            const allSubjects = subjectsResult.rows;

            // Fetch all remark types
            const teacherRemarksResult = await db.query('SELECT id, remark FROM remarks WHERE organization_id = $1 AND remark_type = $2', [organizationId, 'teacher']);
            const conductRemarksResult = await db.query('SELECT id, remark FROM remarks WHERE organization_id = $1 AND remark_type = $2', [organizationId, 'conduct']);
            const interestRemarksResult = await db.query('SELECT id, remark FROM remarks WHERE organization_id = $1 AND remark_type = $2', [organizationId, 'interest']);
            const attitudeRemarksResult = await db.query('SELECT id, remark FROM remarks WHERE organization_id = $1 AND remark_type = $2', [organizationId, 'attitude']);

            const teacherRemarks = teacherRemarksResult.rows;
            const conductRemarks = conductRemarksResult.rows;
            const interestRemarks = interestRemarksResult.rows;
            const attitudeRemarks = attitudeRemarksResult.rows;

            // Fetch score remarks for grade interpretation
            const scoreRemarksResult = await db.query('SELECT from_percentage AS "fromPercentage", to_percentage AS "toPercentage", remark FROM score_remarks WHERE organization_id = $1', [organizationId]);
            const scoreRemarks = scoreRemarksResult.rows;

            // Fetch attendance records for each student
            const attendanceResult = await db.query(`
                SELECT student_id, COUNT(*) FILTER (WHERE status = 'Present') AS present_days
                FROM attendance_records
                WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
                GROUP BY student_id
            `, [parsedClassId, parsedTermId, organizationId]);
            const attendanceMap = {};
            attendanceResult.rows.forEach(record => {
                attendanceMap[record.student_id] = {
                    presentDays: record.present_days,
                    totalDays: totalDays
                };
            });

            // Fetch signature image for specific class and term
            const reportSettingsResult = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3', [organizationId, parsedClassId, parsedTermId]);
            const signatureImagePath = reportSettingsResult.rows[0]?.signature_image_path;
            const signatureImageUrl = signatureImagePath ? await getFromS3(signatureImagePath) : null;

            // Process students and their scores
            let studentScores = [];
            for (const student of students) {
                student.subjects = [];
                let totalPercentageSum = 0;
                let totalScoreSum = 0;
                let subjectCount = 0;

                for (const subject of allSubjects) {
                    const categoryScoresResult = await db.query(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN cs.category = 'Class Assessment' THEN cs.total_score ELSE 0 END), 0) AS classAssessmentScore,
                            COALESCE(SUM(CASE WHEN cs.category = 'Exams Assessment' THEN cs.total_score ELSE 0 END), 0) AS examsAssessmentScore,
                            COALESCE(SUM(CASE WHEN cs.category = 'Other' THEN cs.total_score ELSE 0 END), 0) AS otherAssessmentScore
                        FROM category_scores cs
                        WHERE cs.student_id = $1 AND cs.subject_id = $2 AND cs.class_id = $3 AND cs.organization_id = $4 AND cs.term_id = $5
                    `, [student.student_id, subject.subject_id, parsedClassId, organizationId, parsedTermId]);

                    const categoryScores = categoryScoresResult.rows[0] || {};
                    const classAssessmentScore = categoryScores.classassessmentscore || '-';
                    const examsAssessmentScore = categoryScores.examsassessmentscore || '-';
                    const otherAssessmentScore = categoryScores.otherassessmentscore || '-';

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
                        WHERE a.subject_id = $2 AND a.class_id = $3 AND a.organization_id = $4 AND ar.term_id = $5
                        GROUP BY ar.total_subject_score, ar.total_percentage, sp.position, ar.grade
                    `, [student.student_id, subject.subject_id, parsedClassId, organizationId, parsedTermId]);

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
                    student.promotionClass = promotedClassName;
                } else {
                    student.promotionStatus = 'Repeated';
                    student.promotionClass = repeatedClassName;
                }

                studentScores.push({
                    student_id: student.student_id,
                    first_name: student.first_name,
                    last_name: student.last_name,
                    totalScoreSum: student.totalScoreSum
                });

                // Add attendance details to the student
                student.attendance = attendanceMap[student.student_id] || { presentDays: 0, totalDays: totalDays };
            }

            studentScores.sort((a, b) => b.totalScoreSum - a.totalScoreSum);

            studentScores.forEach((studentScore, index) => {
                const student = students.find(s => s.student_id === studentScore.student_id);
                student.positionInClass = getOrdinalSuffix(index + 1);
            });

            res.render('print/printStudentReport', {
                title: 'Student Final Report',
                students: students,
                orgName: organization.organization_name || 'Default School Name',
                orgAddress: organization.organization_address,
                orgPhone: organization.organization_phone,
                email: organization.email,
                logoUrl: logoUrl,
                signatureImageUrl: signatureImageUrl,
                term: term,
                schoolYearLabel: schoolYearLabel,
                termEndDate: termEndDate, // Updated to use the correct term end date
                teacherRemarks: teacherRemarks,
                conductRemarks: conductRemarks,
                interestRemarks: interestRemarks,
                attitudeRemarks: attitudeRemarks,
                classId: parsedClassId,
                termId: parsedTermId,
                schoolReopenDate: schoolReopenDate,
                promotedClass: promotedClassName,
                repeatedClass: repeatedClassName,
                activatePromotion: activatePromotion,
                scoreRemarks: scoreRemarks
            });
        } catch (error) {
            console.error('Error generating student report:', error);
            res.status(500).send('Failed to generate student report.');
        }
    },

    




        
    reportSettingsPage: async (req, res) => {
        const { classId, termId } = req.query;
        const organizationId = req.session.organizationId;
    
        // Validate input
        if (!classId || isNaN(classId) || !termId || isNaN(termId)) {
            return res.status(400).send('Invalid or missing classId or termId.');
        }
    
        try {
            const parsedClassId = parseInt(classId, 10);
            const parsedTermId = parseInt(termId, 10);
    
            // Fetch status settings for the specific class and term, including term_end_date
            const statusResult = await db.query(`
                SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, term_end_date, activate_promotion
                FROM status_settings 
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 LIMIT 1
            `, [organizationId, parsedClassId, parsedTermId]);
            const statusSettings = statusResult.rows[0] || {};
    
            // Fetch all classes with saved status settings for the given term
            const savedClassesResult = await db.query(`
                SELECT class_id 
                FROM status_settings 
                WHERE organization_id = $1 AND term_id = $2
            `, [organizationId, parsedTermId]);
            const statusSettingsClasses = savedClassesResult.rows.map(row => row.class_id);
    
            // Fetch enrolled classes for the given organization
            const enrolledClassesResult = await db.query(`
                SELECT c.class_id, c.class_name
                FROM enrolled_classes ec
                JOIN classes c ON ec.class_id = c.class_id
                WHERE c.organization_id = $1
            `, [organizationId]);
            const enrolledClasses = enrolledClassesResult.rows || [];
    
            // Fetch all remarks for the given organization (not term-specific)
            const remarksResult = await db.query(`
                SELECT id, remark, remark_type
                FROM remarks
                WHERE organization_id = $1
            `, [organizationId]);
            const remarks = remarksResult.rows || [];
    
            // Fetch score remarks for the specific class and term
            const scoreRemarksResult = await db.query(`
                SELECT * 
                FROM score_remarks 
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
            `, [organizationId, parsedClassId, parsedTermId]);
            const scoreRemarks = scoreRemarksResult.rows || [];
    
            // Fetch signature image for the specific class and term
            const reportSettingsResult = await db.query(`
                SELECT signature_image_path 
                FROM report_settings 
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
            `, [organizationId, parsedClassId, parsedTermId]);
            const reportSettings = reportSettingsResult.rows[0];
            let signatureImageUrl = null;
    
            if (reportSettings && reportSettings.signature_image_path) {
                signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
            }
    
            // Fetch classes with an assigned signature for this term
            const signatureClassesResult = await db.query(`
                SELECT class_id, signature_image_path
                FROM report_settings
                WHERE organization_id = $1 AND term_id = $2 AND signature_image_path IS NOT NULL
            `, [organizationId, parsedTermId]);
            const signatureClasses = signatureClassesResult.rows;
    
            // Group classes by signature image path
            const signatureGroups = {};
            for (const row of signatureClasses) {
                if (!signatureGroups[row.signature_image_path]) {
                    signatureGroups[row.signature_image_path] = {
                        classes: [],
                        signature_image_url: await getFromS3(row.signature_image_path)
                    };
                }
                const classInfo = enrolledClasses.find(classItem => classItem.class_id === row.class_id);
                signatureGroups[row.signature_image_path].classes.push({
                    class_id: row.class_id,
                    class_name: classInfo?.class_name || 'Unknown Class'
                });
            }
    
            // Fetch only classes without an assigned signature
            const assignedClassIds = signatureClasses.map(row => row.class_id);
            const availableClasses = enrolledClasses.filter(classItem => !assignedClassIds.includes(classItem.class_id));
    
            // Render the report settings page with the fetched data
            res.render('print/reportSettings', {
                title: 'Report Settings',
                statusSettings,
                remarks,
                scoreRemarks,
                availableClasses,
                signatureImageUrl,
                signatureGroups,
                statusSettingsClasses,
                enrolledClasses,
                classId: parsedClassId,
                termId: parsedTermId,
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
        const { cutOffPoint, promotedClass, repeatedClass, schoolReopenDate, termEndDate, activatePromotion, selectedStatusClasses, classId: formClassId, termId: formTermId } = req.body;
        const organizationId = req.session.organizationId;
    
        // Attempt to get classId and termId from query or from form
        const classId = formClassId || req.query.classId;
        const termId = formTermId || req.query.termId;
    
        try {
            // Validate organizationId
            if (!organizationId) {
                req.flash('error_msg', 'Organization ID is not set in session.');
                return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
            }
    
            // Validate and parse classId and termId
            if (!classId || !termId) {
                req.flash('error_msg', 'Invalid or missing classId or termId.');
                return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
            }
    
            const parsedClassId = parseInt(classId, 10);
            const parsedTermId = parseInt(termId, 10);
    
            if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
                req.flash('error_msg', 'Invalid class or term ID.');
                return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
            }
    
            // Determine which classes are currently selected
            let classesToApply = Array.isArray(selectedStatusClasses) ? selectedStatusClasses.map(id => parseInt(id, 10)) : [parsedClassId];
    
            // Insert or update settings for the selected classes
            for (const currentClassId of classesToApply) {
                await db.query(`
                    INSERT INTO status_settings (organization_id, class_id, term_id, cut_off_point, promoted_class, repeated_class, school_reopen_date, term_end_date, activate_promotion)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (organization_id, class_id, term_id)
                    DO UPDATE SET 
                        cut_off_point = EXCLUDED.cut_off_point,
                        promoted_class = EXCLUDED.promoted_class,
                        repeated_class = EXCLUDED.repeated_class,
                        school_reopen_date = EXCLUDED.school_reopen_date,
                        term_end_date = EXCLUDED.term_end_date,
                        activate_promotion = EXCLUDED.activate_promotion
                `, [
                    organizationId,
                    currentClassId,
                    parsedTermId,
                    parseInt(cutOffPoint, 10) || null,
                    promotedClass || null,
                    repeatedClass || null,
                    schoolReopenDate || null,
                    termEndDate || null,
                    activatePromotion === "on"
                ]);
            }
    
            req.flash('success_msg', 'Promotion settings saved successfully.');
            res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
        } catch (error) {
            console.error('Error saving promotion settings:', error);
            req.flash('error_msg', 'Error saving promotion settings.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        }
    },
                

    saveRemarks: async (req, res) => {
        const organizationId = req.session.organizationId;
        const remarks = req.body['remarks[]'] || req.body.remarks || [];
        const remarkTypes = req.body['remarkType[]'] || req.body.remarkType || [];
        const { classId, termId } = req.query; // Get classId and termId from the query parameters
    
        if (!organizationId) {
            req.flash('error_msg', 'Organization ID is not set in session.');
            return res.redirect(`/print/reportSettings`);
        }
    
        try {
            // Convert remarks and remarkTypes to arrays if they are single values
            const remarksArray = Array.isArray(remarks) ? remarks : [remarks];
            const remarkTypesArray = Array.isArray(remarkTypes) ? remarkTypes : [remarkTypes];
    
            // Insert each remark and corresponding remark type
            for (let i = 0; i < remarksArray.length; i++) {
                await db.query(`
                    INSERT INTO remarks (organization_id, remark, remark_type)
                    VALUES ($1, $2, $3)
                `, [organizationId, remarksArray[i], remarkTypesArray[i]]);
            }
    
            req.flash('success_msg', 'Remarks saved successfully.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        } catch (error) {
            console.error('Error saving remarks:', error);
            req.flash('error_msg', 'Failed to save remarks.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        }
    },
    
        
    deleteRemark: async (req, res) => {
        const { id } = req.params;
        const { classId, termId } = req.query; // Get classId and termId from the query parameters
    
        try {
            await db.query('DELETE FROM remarks WHERE id = $1', [id]);
            req.flash('success_msg', 'Remark deleted successfully.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        } catch (error) {
            console.error('Error deleting remark:', error);
            req.flash('error_msg', 'Error deleting remark.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        }
    },
    
    
    
    

    saveScoreRemarks: async (req, res) => {
        const { remark, from_percentage, to_percentage } = req.body;
        const organizationId = req.session.organizationId;
    
        // Get classId and termId from query or form
        const termId = req.query.termId || req.body.termId;
        const classId = req.query.classId || req.body.classId;
    
        try {
            if (!organizationId) {
                req.flash('error_msg', 'Organization ID is not set in session.');
                return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
            }
    
            // Validate classId and termId
            if (!termId || isNaN(termId) || !classId || isNaN(classId)) {
                req.flash('error_msg', 'Invalid or missing classId or termId.');
                return res.redirect(`/print/reportSettings`);
            }
    
            // Convert classId and termId to integers
            const parsedTermId = parseInt(termId, 10);
            const parsedClassId = parseInt(classId, 10);
    
            // Insert or update score remark for the specific class and term
            await db.query(`
                INSERT INTO score_remarks (organization_id, class_id, term_id, remark, from_percentage, to_percentage)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (organization_id, class_id, term_id, remark) DO UPDATE
                SET from_percentage = EXCLUDED.from_percentage,
                    to_percentage = EXCLUDED.to_percentage
            `, [organizationId, parsedClassId, parsedTermId, remark, from_percentage, to_percentage]);
    
            req.flash('success_msg', 'Score remarks saved successfully.');
            res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
        } catch (error) {
            console.error('Error saving score remarks:', error);
            req.flash('error_msg', 'Failed to save score remarks.');
            res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        }
    },        
    

    deleteScoreRemark: async (req, res) => {
        const { id } = req.params;
        const termId = req.query.termId;
    
        try {
            if (!termId) {
                req.flash('error_msg', 'Invalid or missing termId.');
                return res.redirect('/print/reportSettings');
            }
    
            await db.query('DELETE FROM score_remarks WHERE id = $1', [id]);
    
            req.flash('success_msg', 'Score remark deleted successfully.');
            res.redirect(`/print/reportSettings?termId=${termId}`);
        } catch (error) {
            console.error('Error deleting score remark:', error);
            req.flash('error_msg', 'Error deleting score remark.');
            res.redirect(`/print/reportSettings?termId=${termId}`);
        }
    },
    
    
    
uploadSignatureImage: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { classId, termId, applyAllClasses, selectedSignatureClasses } = req.body;

    if (!file) {
        req.flash('error_msg', 'No file uploaded.');
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }

    try {
        if (!organizationId) {
            req.flash('error_msg', 'Organization ID is not set in session.');
            return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
        }

        if (!termId) {
            req.flash('error_msg', 'Invalid or missing termId.');
            return res.redirect(`/print/reportSettings?classId=${classId}`);
        }

        let classesToApply = [];
        if (applyAllClasses) {
            const allClassesResult = await db.query('SELECT class_id FROM classes WHERE organization_id = $1', [organizationId]);
            classesToApply = allClassesResult.rows.map(row => row.class_id);
        } else if (Array.isArray(selectedSignatureClasses)) {
            classesToApply = selectedSignatureClasses.map(id => parseInt(id, 10));
        } else if (classId) {
            classesToApply = [parseInt(classId)];
        }

        const key = `signatures/${organizationId}/${Date.now()}_${file.originalname}`;
        const uploadedKey = await uploadToS3(key, file);

        for (const currentClassId of classesToApply) {
            // Delete the existing signature if it already exists
            const existingSignatureResult = await db.query(`
                SELECT signature_image_path 
                FROM report_settings 
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
            `, [organizationId, currentClassId, termId]);

            const existingSignaturePath = existingSignatureResult.rows[0]?.signature_image_path;
            if (existingSignaturePath) {
                await deleteFromS3(existingSignaturePath);
            }

            // Insert or update the new signature image path
            await db.query(`
                INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (organization_id, class_id, term_id)
                DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path
            `, [organizationId, currentClassId, termId, uploadedKey]);
        }

        req.flash('success_msg', 'Signature image uploaded successfully.');
        res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
        console.error('Error uploading signature image:', error);
        req.flash('error_msg', 'Failed to upload signature image.');
        res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
},

deleteSignatureImage: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId, termId } = req.query;

    if (!organizationId) {
        req.flash('error_msg', 'Organization ID is not set in session.');
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }

    if (!termId) {
        req.flash('error_msg', 'Invalid or missing termId.');
        return res.redirect(`/print/reportSettings?classId=${classId}`);
    }

    try {
        const result = await db.query('SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3', [organizationId, classId, termId]);
        const signatureImagePath = result.rows[0]?.signature_image_path;

        if (signatureImagePath) {
            await deleteFromS3(signatureImagePath);
        }

        await db.query('UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3', [organizationId, classId, termId]);

        req.flash('success_msg', 'Signature image deleted successfully.');
        res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
        console.error('Error deleting signature image:', error);
        req.flash('error_msg', 'Failed to delete signature image.');
        res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
}
});

module.exports = printController;
