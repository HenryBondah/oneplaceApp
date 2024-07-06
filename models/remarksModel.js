const pool = require('../config/db');

const Remark = {
    getAllTeacherRemarks: async () => {
        try {
            const result = await pool.query('SELECT * FROM remarks WHERE type = $1', ['teacher']);
            return result.rows;
        } catch (err) {
            console.error('Error fetching teacher remarks:', err);
            throw err;
        }
    },

    getAllHeadTeacherRemarks: async () => {
        try {
            const result = await pool.query('SELECT * FROM remarks WHERE type = $1', ['head_teacher']);
            return result.rows;
        } catch (err) {
            console.error('Error fetching head teacher remarks:', err);
            throw err;
        }
    },

    addRemark: async (type, remarks) => {
        try {
            const result = await pool.query('INSERT INTO remarks (type, remarks) VALUES ($1, $2) RETURNING *', [type, remarks]);
            return result.rows[0];
        } catch (err) {
            console.error('Error adding remark:', err);
            throw err;
        }
    },

    updateRemark: async (id, remarks) => {
        try {
            const result = await pool.query('UPDATE remarks SET remarks = $1 WHERE id = $2 RETURNING *', [remarks, id]);
            return result.rows[0];
        } catch (err) {
            console.error('Error updating remark:', err);
            throw err;
        }
    },

    deleteRemark: async (id) => {
        try {
            const result = await pool.query('DELETE FROM remarks WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } catch (err) {
            console.error('Error deleting remark:', err);
            throw err;
        }
    }
};

module.exports = Remark;
