const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require('../config/s3');
const path = require('path');
const organizationCache = {};
const CACHE_DURATION = 10 * 60 * 1000; // Cache organization data for 10 minutes
const { redisClient } = require('../config/redis'); // Ensure Redis is set up as described above


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

    // Helper function to get correct ordinal suffix
    function getOrdinalSuffix(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
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

// Helper function to fetch and cache organization details
async function getCachedOrganizationDetails(organizationId, db) {
    const cacheKey = `org_${organizationId}`;
    const now = Date.now();

    if (organizationCache[cacheKey] && (now - organizationCache[cacheKey].timestamp) < CACHE_DURATION) {
        return organizationCache[cacheKey].data;
    }

    const organizationResult = await db.query(`
        SELECT organization_name, organization_address, organization_phone, email, logo_path 
        FROM organizations 
        WHERE organization_id = $1
    `, [organizationId]);

    const organization = organizationResult.rows[0];
    if (organization) {
        organizationCache[cacheKey] = {
            data: organization,
            timestamp: now
        };
    }

    return organization;
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
    
            // Fetch organization details
            const organization = await getCachedOrganizationDetails(organizationId, db);
            if (!organization) {
                return res.status(404).send('Organization not found.');
            }
    
            const logoUrl = organization.logo_path ? await getFromS3(organization.logo_path) : null;
    
            // Fetch class and term details
            const [classResult, termResult] = await Promise.all([
                db.query(
                    'SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2',
                    [parsedClassId, organizationId]
                ),
                db.query(`
                    SELECT t.term_name, t.start_date, t.end_date, sy.year_label
                    FROM terms t
                    JOIN school_years sy ON t.school_year_id = sy.id
                    WHERE t.term_id = $1 AND t.organization_id = $2
                `, [parsedTermId, organizationId])
            ]);
    
            const classData = classResult.rows[0];
            const term = termResult.rows[0];
    
            if (!classData) {
                return res.status(404).send('Class not found for the given class ID and organization ID.');
            }
    
            if (!term) {
                return res.status(404).send('Term not found for the given term ID.');
            }
    
            // Fetch status settings
            const statusSettingsResult = await db.query(`
                SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion, term_end_date
                FROM status_settings
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
            `, [organizationId, parsedClassId, parsedTermId]);
    
            const statusSettings = statusSettingsResult.rows[0] || {};
            const cutOffPoint = statusSettings.cut_off_point || 50;
            const schoolReopenDate = statusSettings.school_reopen_date
                ? new Date(statusSettings.school_reopen_date).toLocaleDateString()
                : 'TBA';
            const termEndDate = statusSettings.term_end_date
                ? new Date(statusSettings.term_end_date).toLocaleDateString()
                : new Date(term.end_date).toLocaleDateString();
    
            const promotedClassId = statusSettings.promoted_class;
            const repeatedClassId = statusSettings.repeated_class;
    
            // Fetch promoted/repeated class names
            const [promotedClassName, repeatedClassName] = await Promise.all([
                promotedClassId
                    ? db.query('SELECT class_name FROM classes WHERE class_id = $1', [promotedClassId]).then(res => res.rows[0]?.class_name || 'No Promoted Class')
                    : 'No Promoted Class',
                repeatedClassId
                    ? db.query('SELECT class_name FROM classes WHERE class_id = $1', [repeatedClassId]).then(res => res.rows[0]?.class_name || 'No Repeated Class')
                    : 'No Repeated Class'
            ]);
    
            // Calculate attendance days
            const totalDaysResult = await db.query(`
                SELECT COUNT(*) AS total_days
                FROM generate_series($1::date, LEAST($2::date, CURRENT_DATE), '1 day') AS all_dates
                WHERE EXTRACT(ISODOW FROM all_dates) < 6
            `, [term.start_date, term.end_date]);
            const totalDays = totalDaysResult.rows[0]?.total_days || 0;
    
            // Fetch max scores for each subject
            const maxScoresResult = await db.query(`
                SELECT subject_id, SUM(max_score) AS max_score
                FROM assessments
                WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
                GROUP BY subject_id
            `, [parsedClassId, parsedTermId, organizationId]);
    
            const maxScoresMap = maxScoresResult.rows.reduce((map, row) => {
                map[row.subject_id] = row.max_score || 100; // Default to 100 if no max_score is found
                return map;
            }, {});
    
            // Fetch students, subjects, remarks, and scores
            const [studentsResult, subjectsResult, remarksResult, scoreRemarksResult, reportSettingsResult, attendanceResult, scoresResult] = await Promise.all([
                db.query(`
                    SELECT es.student_id, s.first_name, s.last_name, s.image_url, c.class_name
                    FROM enrolled_students es
                    JOIN students s ON es.student_id = s.student_id
                    JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                    JOIN classes c ON es.class_id = c.class_id
                    WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
                `, [parsedClassId, parsedTermId, organizationId]),
                db.query('SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2', [parsedClassId, organizationId]),
                db.query('SELECT id, remark, remark_type FROM remarks WHERE organization_id = $1', [organizationId]),
                db.query('SELECT from_percentage AS "fromPercentage", to_percentage AS "toPercentage", remark FROM score_remarks WHERE organization_id = $1', [organizationId]),
                db.query('SELECT signature_image_path FROM report_settings WHERE class_id = $1 AND term_id = $2 AND organization_id = $3', [parsedClassId, parsedTermId, organizationId]),
                db.query(`
                    SELECT student_id, COUNT(*) FILTER (WHERE status = 'Present') AS present_days
                    FROM attendance_records
                    WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
                    GROUP BY student_id
                `, [parsedClassId, parsedTermId, organizationId]),
                db.query(`
                    SELECT student_id, subject_id, category,
                        SUM(total_score) AS total_score
                    FROM category_scores
                    WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
                    GROUP BY student_id, subject_id, category
                `, [parsedClassId, parsedTermId, organizationId])
            ]);
    
            const students = studentsResult.rows;
            const allSubjects = subjectsResult.rows;
            const teacherRemarks = remarksResult.rows.filter(r => r.remark_type === 'teacher');
            const conductRemarks = remarksResult.rows.filter(r => r.remark_type === 'conduct');
            const interestRemarks = remarksResult.rows.filter(r => r.remark_type === 'interest');
            const attitudeRemarks = remarksResult.rows.filter(r => r.remark_type === 'attitude');
            const scoreRemarks = scoreRemarksResult.rows;
            const signatureImagePath = reportSettingsResult.rows[0]?.signature_image_path;
            const signatureImageUrl = signatureImagePath ? await getFromS3(signatureImagePath) : null;
    
            const attendanceMap = Object.fromEntries(
                attendanceResult.rows.map(record => [record.student_id, record.present_days || 0])
            );
    
            // Map scores for easy access
            const scoresMap = scoresResult.rows.reduce((acc, row) => {
                acc[`${row.student_id}_${row.subject_id}_${row.category}`] = row.total_score || 0;
                return acc;
            }, {});
    
            // Process students
            students.forEach(student => {
                let totalScoreSum = 0;
                let totalPercentageSum = 0;
                let subjectCount = 0;
    
                student.subjects = allSubjects.map(subject => {
                    const maxScore = maxScoresMap[subject.subject_id] || 100; // Default max score is 100
                
                    const classScore = parseFloat(scoresMap[`${student.student_id}_${subject.subject_id}_Class Assessment`] || 0);
                    const examsScore = parseFloat(scoresMap[`${student.student_id}_${subject.subject_id}_Exams Assessment`] || 0);
                    const otherScore = parseFloat(scoresMap[`${student.student_id}_${subject.subject_id}_Other Assessment`] || 0);
                
                    const totalScore = classScore + examsScore + otherScore;
                    const totalPercentage = maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(2) : '0.00';
                
                    // Assign grade and remarks
                    const matchingRemark = scoreRemarks.find(rule =>
                        parseFloat(totalPercentage) >= parseFloat(rule.fromPercentage) &&
                        parseFloat(totalPercentage) <= parseFloat(rule.toPercentage)
                    );
                
                    const grade = matchingRemark ? matchingRemark.remark : '-'; // Default grade is F
                    const remarks = matchingRemark ? matchingRemark.remark : 'No Remarks'; // Default remark if no match
                
                    if (totalPercentage > 0) {
                        totalPercentageSum += parseFloat(totalPercentage);
                        subjectCount++;
                    }
                    totalScoreSum += totalScore;
                
                    return {
                        subject_name: subject.subject_name,
                        classAssessmentScore: classScore.toFixed(2),
                        examsAssessmentScore: examsScore.toFixed(2),
                        otherAssessmentScore: otherScore.toFixed(2),
                        totalScore: totalScore.toFixed(2),
                        totalPercentage: `${totalPercentage} %`,
                        grade: grade,
                        remarks: remarks, // Include remarks in the output
                        position: '-', // Placeholder for position
                    };
                });
                                    
                student.totalScoreSum = totalScoreSum;
                const totalMaxPercentage = subjectCount * 100; // Each subject contributes 100%
                student.overallPercentage = totalMaxPercentage > 0
                    ? ((totalPercentageSum / totalMaxPercentage) * 100).toFixed(2)
                    : '0.00';
    
                student.attendance = {
                    presentDays: attendanceMap[student.student_id] || 0,
                    totalDays,
                };
                student.promotionClass = student.overallPercentage >= cutOffPoint ? promotedClassName : repeatedClassName;
                student.promotionStatus = student.overallPercentage >= cutOffPoint ? 'Promoted' : 'Repeated';
            });
    
            // Sort students by total score and assign positions
            students.sort((a, b) => b.totalScoreSum - a.totalScoreSum).forEach((student, index) => {
                student.positionInClass = `${index + 1}${getOrdinalSuffix(index + 1)}`;
            });
    
            // Process subject positions
            allSubjects.forEach(subject => {
                const subjectScores = students.map(student => ({
                    student_id: student.student_id,
                    totalScore: parseFloat(student.subjects.find(s => s.subject_name === subject.subject_name)?.totalScore || 0),
                }));
    
                subjectScores.sort((a, b) => b.totalScore - a.totalScore).forEach((score, index) => {
                    const student = students.find(s => s.student_id === score.student_id);
                    const subjectData = student.subjects.find(s => s.subject_name === subject.subject_name);
                    if (subjectData) {
                        subjectData.position = `${index + 1}${getOrdinalSuffix(index + 1)}`;
                    }
                });
            });
    
            // Render the report
            res.render('print/printStudentReport', {
                title: 'Student Final Report',
                students,
                orgName: organization.organization_name || 'Default School Name',
                orgAddress: organization.organization_address,
                orgPhone: organization.organization_phone,
                email: organization.email,
                logoUrl,
                signatureImageUrl,
                term,
                schoolYearLabel: term.year_label || 'No School Year Available',
                termEndDate,
                teacherRemarks,
                conductRemarks,
                interestRemarks,
                attitudeRemarks,
                scoreRemarks,
                classId: parsedClassId,
                termId: parsedTermId,
                schoolReopenDate,
                promotedClass: promotedClassName,
                repeatedClass: repeatedClassName,
                activatePromotion: statusSettings.activate_promotion,
                scoreRemarks: scoreRemarks,
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
}, 

meritSheetPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
        // Fetch organization details
        const organizationResult = await db.query(`
            SELECT organization_name, logo_path 
            FROM organizations 
            WHERE organization_id = $1
        `, [organizationId]);

        const organization = organizationResult.rows[0];
        if (!organization) {
            return res.status(404).send('Organization not found.');
        }

        const logoUrl = organization.logo_path
            ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
            : null;

        // Fetch class, term, and school year information
        const classDetailsResult = await db.query(`
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON c.class_id = $1 AND t.term_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.organization_id = $3
        `, [classId, termId, organizationId]);

        if (classDetailsResult.rows.length === 0) {
            return res.status(404).send('Class or term details not found.');
        }

        const { class_name: className, term_name: termName, year_label: schoolYear } = classDetailsResult.rows[0];

        // Fetch subjects for the class
        const subjectsResult = await db.query(`
            SELECT subject_id, subject_name
            FROM subjects
            WHERE class_id = $1 AND organization_id = $2
        `, [classId, organizationId]);

        const subjects = await Promise.all(subjectsResult.rows.map(async (subject) => {
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, category
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND term_id = $3 AND organization_id = $4
            `, [subject.subject_id, classId, termId, organizationId]);

            return {
                ...subject,
                assessments: assessmentsResult.rows,
            };
        }));

        // Render the page with organization name and logo
        res.render('print/meritSheetPage', {
            title: 'Merit Sheet Page',
            classId,
            termId,
            className,
            termName,
            schoolYear,
            subjects,
            meritSheet: [], // Initialize meritSheet to avoid ReferenceError
            orgName: organization.organization_name,
            logoUrl: logoUrl,
        });
    } catch (error) {
        console.error('Error rendering merit sheet page:', error);
        res.status(500).send('Failed to load merit sheet page.');
    }
},





getAssessmentsForSubject: async (req, res) => {
    const { subjectId, classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
        // Fetch assessments for the specified subject, class, term, and organization
        const assessmentsResult = await db.query(`
            SELECT a.assessment_id, a.title, a.weight, a.category, a.max_score
            FROM assessments a
            WHERE a.subject_id = $1 AND a.class_id = $2 AND a.term_id = $3 AND a.organization_id = $4
        `, [subjectId, classId, termId, organizationId]);

        res.json(assessmentsResult.rows);
    } catch (error) {
        console.error('Error fetching assessments:', error);
        res.status(500).send('Failed to fetch assessments.');
    }
},


generateMeritSheet: async (req, res) => {
    const { classId, termId, selectedSubjects, selectedAssessments } = req.body;
    const organizationId = req.session.organizationId;

    try {
        if (!classId || !termId || !organizationId) {
            return res.status(400).send('Class, term, or organization ID is missing.');
        }

        const subjectIds = Array.isArray(selectedSubjects)
            ? selectedSubjects.map(Number)
            : [Number(selectedSubjects)];
        const assessmentIds = Array.isArray(selectedAssessments)
            ? selectedAssessments.map(Number)
            : [Number(selectedAssessments)];

        // Fetch organization details
        const organizationResult = await db.query(`
            SELECT organization_name, logo_path
            FROM organizations
            WHERE organization_id = $1
        `, [organizationId]);
        const organization = organizationResult.rows[0];

        if (!organization) {
            return res.status(404).send('Organization not found.');
        }

        const logoUrl = organization.logo_path
            ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
            : null;

        // Fetch class, term, and school year details
        const classDetailsResult = await db.query(`
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON t.term_id = $1 AND t.organization_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.class_id = $3 AND c.organization_id = $2
        `, [termId, organizationId, classId]);

        if (classDetailsResult.rows.length === 0) {
            return res.status(404).send('Class or term details not found.');
        }

        const { class_name: className, term_name: termName, year_label: schoolYear } = classDetailsResult.rows[0];

        // Fetch selected subjects and assessments
        const subjectsResult = await db.query(`
            SELECT subject_id, subject_name
            FROM subjects
            WHERE subject_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3
        `, [subjectIds, classId, organizationId]);

        const selectedSubjectsData = await Promise.all(subjectsResult.rows.map(async (subject) => {
            const assessmentsResult = await db.query(`
                SELECT assessment_id, title, weight, category, max_score
                FROM assessments
                WHERE assessment_id = ANY($1::int[]) AND subject_id = $2 AND class_id = $3 AND term_id = $4 AND organization_id = $5
            `, [assessmentIds, subject.subject_id, classId, termId, organizationId]);

            return {
                ...subject,
                assessments: assessmentsResult.rows,
            };
        }));

        // Fetch students enrolled in the class for the given term
        const enrolledStudentsResult = await db.query(`
            SELECT es.student_id, s.first_name, s.last_name
            FROM enrolled_students es
            JOIN students s ON es.student_id = s.student_id
            JOIN enrollments e ON es.enrollment_id = e.enrollment_id
            WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
        `, [classId, termId, organizationId]);

        const students = enrolledStudentsResult.rows;

        const scoresResult = await db.query(`
            SELECT ar.student_id, a.subject_id, ar.score, a.title AS assessment_title, ar.grade, a.weight
            FROM assessment_results ar
            JOIN assessments a ON ar.assessment_id = a.assessment_id
            WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3
        `, [classId, termId, organizationId]);

        const scores = scoresResult.rows;

        // Process students and attach scores, grades, and positions
        const meritSheetData = students.map((student) => {
            const studentScores = selectedSubjectsData.map((subject) => {
                const subjectAssessments = subject.assessments.map((assessment) => {
                    const scoreData = scores.find(
                        (score) =>
                            score.student_id === student.student_id &&
                            score.subject_id === subject.subject_id &&
                            score.assessment_title === assessment.title
                    );

                    return {
                        title: assessment.title,
                        score: scoreData ? scoreData.score : '-',
                        grade: scoreData ? scoreData.grade : '-',
                        weight: assessment.weight,
                    };
                });

                const totalSubjectScore = subjectAssessments.reduce((total, assessment) => {
                    return total + (assessment.score !== '-' ? parseFloat(assessment.score) : 0);
                }, 0);

                return {
                    subjectName: subject.subject_name,
                    assessments: subjectAssessments,
                    totalScore: totalSubjectScore,
                };
            });

            const totalScore = studentScores.reduce((total, subject) => total + subject.totalScore, 0);
            const averageScore = totalScore / studentScores.length;

            return {
                studentId: student.student_id,
                name: `${student.first_name} ${student.last_name}`,
                scores: studentScores,
                totalScore: totalScore.toFixed(2),
                averageScore: averageScore.toFixed(2),
            };
        });

        // Sort students by total score and assign positions
        meritSheetData.sort((a, b) => b.totalScore - a.totalScore);
        meritSheetData.forEach((student, index) => {
            student.position = getOrdinalSuffix(index + 1);
        });

        res.render('print/meritSheetPage', {
            title: 'Merit Sheet',
            orgName: organization.organization_name,
            logoUrl,
            className,
            termName,
            schoolYear,
            subjects: selectedSubjectsData,
            meritSheet: meritSheetData,
        });
    } catch (error) {
        console.error('Error generating merit sheet:', error);
        res.status(500).send('Failed to generate merit sheet.');
    }
},

});

module.exports = printController;
