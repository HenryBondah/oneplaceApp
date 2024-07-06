// models/classModel.js

exports.createClass = async (pool, className, gradYearGroupId) => {
    const query = `
        INSERT INTO classes (class_name, grad_year_group_id)
        VALUES ($1, $2)
        RETURNING class_id, class_name, grad_year_group_id
    `;
    const values = [className, gradYearGroupId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating class:', error);
        throw error;
    }
};

exports.getClassById = async (pool, classId) => {
    const query = 'SELECT * FROM classes WHERE class_id = $1';
    const values = [classId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting class by ID:', error);
        throw error;
    }
};

exports.getAllClasses = async (pool) => {
    const query = 'SELECT * FROM classes';

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all classes:', error);
        throw error;
    }
};

exports.updateClass = async (pool, classId, newClassName) => {
    const query = `
        UPDATE classes
        SET class_name = $1
        WHERE class_id = $2
        RETURNING class_id, class_name, grad_year_group_id
    `;
    const values = [newClassName, classId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating class:', error);
        throw error;
    }
};

exports.deleteClass = async (pool, classId) => {
    const query = 'DELETE FROM classes WHERE class_id = $1';
    const values = [classId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting class:', error);
        throw error;
    }
};

exports.getClassesByGradYearGroupId = async (pool, gradYearGroupId) => {
    const query = 'SELECT * FROM classes WHERE grad_year_group_id = $1';
    const values = [gradYearGroupId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting classes by graduation year group ID:', error);
        throw error;
    }
};
