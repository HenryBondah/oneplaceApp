// models/studentModel.js

exports.createStudent = async (pool, studentData) => {
    const query = `
        INSERT INTO students (first_name, last_name, date_of_birth, height, hometown, image_url, class_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING student_id, first_name, last_name, date_of_birth, height, hometown, image_url, class_id
    `;
    const values = [
        studentData.firstName,
        studentData.lastName,
        studentData.dateOfBirth,
        studentData.height,
        studentData.hometown,
        studentData.imageUrl,
        studentData.classId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating student:', error);
        throw error;
    }
};

exports.getStudentById = async (pool, studentId) => {
    const query = `
        SELECT s.*, c.class_name, g.name AS grad_year_group_name
        FROM students s
        JOIN classes c ON s.class_id = c.class_id
        JOIN grad_year_groups g ON c.grad_year_group_id = g.id
        WHERE s.student_id = $1
    `;
    const values = [studentId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting student by ID:', error);
        throw error;
    }
};

exports.getAllStudents = async (pool) => {
    const query = `
        SELECT s.*, c.class_name, g.name AS grad_year_group_name
        FROM students s
        JOIN classes c ON s.class_id = c.class_id
        JOIN grad_year_groups g ON c.grad_year_group_id = g.id
    `;

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all students:', error);
        throw error;
    }
};

exports.updateStudent = async (pool, studentId, studentData) => {
    const query = `
        UPDATE students
        SET first_name = $1, last_name = $2, date_of_birth = $3, height = $4, hometown = $5, image_url = $6, class_id = $7
        WHERE student_id = $8
        RETURNING student_id, first_name, last_name, date_of_birth, height, hometown, image_url, class_id
    `;
    const values = [
        studentData.firstName,
        studentData.lastName,
        studentData.dateOfBirth,
        studentData.height,
        studentData.hometown,
        studentData.imageUrl,
        studentData.classId,
        studentId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating student:', error);
        throw error;
    }
};

exports.deleteStudent = async (pool, studentId) => {
    const query = 'DELETE FROM students WHERE student_id = $1';
    const values = [studentId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting student:', error);
        throw error;
    }
};

exports.getStudentsByClassId = async (pool, classId) => {
    const query = `
        SELECT s.*, c.class_name, g.name AS grad_year_group_name
        FROM students s
        JOIN classes c ON s.class_id = c.class_id
        JOIN grad_year_groups g ON c.grad_year_group_id = g.id
        WHERE s.class_id = $1
    `;
    const values = [classId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting students by class ID:', error);
        throw error;
    }
};
