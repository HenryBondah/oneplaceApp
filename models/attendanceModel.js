// models/attendanceModel.js

exports.createAttendanceRecord = async (pool, attendanceData) => {
    const query = `
        INSERT INTO attendance (student_id, class_id, date, status)
        VALUES ($1, $2, $3, $4)
        RETURNING attendance_id, student_id, class_id, date, status
    `;
    const values = [
        attendanceData.studentId,
        attendanceData.classId,
        attendanceData.date,
        attendanceData.status
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating attendance record:', error);
        throw error;
    }
};

exports.getAttendanceByStudentId = async (pool, studentId) => {
    const query = `
        SELECT *
        FROM attendance
        WHERE student_id = $1
    `;
    const values = [studentId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting attendance by student ID:', error);
        throw error;
    }
};

exports.getAttendanceByClassIdAndDate = async (pool, classId, date) => {
    const query = `
        SELECT *
        FROM attendance
        WHERE class_id = $1 AND date = $2
    `;
    const values = [classId, date];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting attendance by class ID and date:', error);
        throw error;
    }
};

exports.updateAttendanceRecord = async (pool, attendanceId, attendanceData) => {
    const query = `
        UPDATE attendance
        SET student_id = $1, class_id = $2, date = $3, status = $4
        WHERE attendance_id = $5
        RETURNING attendance_id, student_id, class_id, date, status
    `;
    const values = [
        attendanceData.studentId,
        attendanceData.classId,
        attendanceData.date,
        attendanceData.status,
        attendanceId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating attendance record:', error);
        throw error;
    }
};

exports.deleteAttendanceRecord = async (pool, attendanceId) => {
    const query = 'DELETE FROM attendance WHERE attendance_id = $1';
    const values = [attendanceId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        throw error;
    }
};

exports.getAttendanceForClass = async (pool, classId) => {
    const query = `
        SELECT *
        FROM attendance
        WHERE class_id = $1
    `;
    const values = [classId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting attendance for class:', error);
        throw error;
    }
};
