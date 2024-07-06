// models/termModel.js

exports.createTerm = async (pool, termData) => {
    const query = `
        INSERT INTO terms (term_name, start_date, end_date, current, school_year_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING term_id, term_name, start_date, end_date, current, school_year_id
    `;
    const values = [
        termData.termName,
        termData.startDate,
        termData.endDate,
        termData.current,
        termData.schoolYearId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating term:', error);
        throw error;
    }
};

exports.getTermById = async (pool, termId) => {
    const query = `
        SELECT *
        FROM terms
        WHERE term_id = $1
    `;
    const values = [termId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting term by ID:', error);
        throw error;
    }
};

exports.getAllTerms = async (pool) => {
    const query = `
        SELECT *
        FROM terms
    `;

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all terms:', error);
        throw error;
    }
};

exports.updateTerm = async (pool, termId, termData) => {
    const query = `
        UPDATE terms
        SET term_name = $1, start_date = $2, end_date = $3, current = $4, school_year_id = $5
        WHERE term_id = $6
        RETURNING term_id, term_name, start_date, end_date, current, school_year_id
    `;
    const values = [
        termData.termName,
        termData.startDate,
        termData.endDate,
        termData.current,
        termData.schoolYearId,
        termId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating term:', error);
        throw error;
    }
};

exports.deleteTerm = async (pool, termId) => {
    const query = 'DELETE FROM terms WHERE term_id = $1';
    const values = [termId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting term:', error);
        throw error;
    }
};

exports.getTermsBySchoolYearId = async (pool, schoolYearId) => {
    const query = `
        SELECT *
        FROM terms
        WHERE school_year_id = $1
    `;
    const values = [schoolYearId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting terms by school year ID:', error);
        throw error;
    }
};
