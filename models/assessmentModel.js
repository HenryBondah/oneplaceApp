// models/assessmentModel.js

exports.createAssessment = async (pool, assessmentData) => {
    const query = `
        INSERT INTO assessments (title, weight, class_id, subject_id)
        VALUES ($1, $2, $3, $4)
        RETURNING assessment_id, title, weight, class_id, subject_id
    `;
    const values = [
        assessmentData.title,
        assessmentData.weight,
        assessmentData.classId,
        assessmentData.subjectId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating assessment:', error);
        throw error;
    }
};

exports.getAssessmentById = async (pool, assessmentId) => {
    const query = `
        SELECT *
        FROM assessments
        WHERE assessment_id = $1
    `;
    const values = [assessmentId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting assessment by ID:', error);
        throw error;
    }
};

exports.getAllAssessments = async (pool) => {
    const query = `
        SELECT *
        FROM assessments
    `;

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all assessments:', error);
        throw error;
    }
};

exports.updateAssessment = async (pool, assessmentId, assessmentData) => {
    const query = `
        UPDATE assessments
        SET title = $1, weight = $2, class_id = $3, subject_id = $4
        WHERE assessment_id = $5
        RETURNING assessment_id, title, weight, class_id, subject_id
    `;
    const values = [
        assessmentData.title,
        assessmentData.weight,
        assessmentData.classId,
        assessmentData.subjectId,
        assessmentId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating assessment:', error);
        throw error;
    }
};

exports.deleteAssessment = async (pool, assessmentId) => {
    const query = 'DELETE FROM assessments WHERE assessment_id = $1';
    const values = [assessmentId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting assessment:', error);
        throw error;
    }
};

exports.getAssessmentsByClassAndSubject = async (pool, classId, subjectId) => {
    const query = `
        SELECT *
        FROM assessments
        WHERE class_id = $1 AND subject_id = $2
    `;
    const values = [classId, subjectId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting assessments by class and subject:', error);
        throw error;
    }
};
