const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DB_CONNECTION_STRING,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

exports.getAllAnnouncements = async () => {
    try {
        const query = 'SELECT * FROM announcements ORDER BY announcement_id DESC';
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all announcements:', error);
        throw error;
    }
};

exports.addAnnouncement = async (announcementData) => {
    const { message, visibility, organization_id } = announcementData;
    try {
        const query = 'INSERT INTO announcements (message, visibility, organization_id) VALUES ($1, $2, $3) RETURNING *';
        const result = await pool.query(query, [message, visibility, organization_id]);
        return result.rows[0];
    } catch (error) {
        console.error('Error adding announcement:', error);
        throw error;
    }
};

exports.updateAnnouncement = async (announcementData) => {
    const { announcementId, message, visibility } = announcementData;
    try {
        const query = 'UPDATE announcements SET message = $1, visibility = $2 WHERE announcement_id = $3 RETURNING *';
        const result = await pool.query(query, [message, visibility, announcementId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating announcement:', error);
        throw error;
    }
};

exports.deleteAnnouncement = async (announcementId) => {
    try {
        const query = 'DELETE FROM announcements WHERE announcement_id = $1 RETURNING *';
        const result = await pool.query(query, [announcementId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error deleting announcement:', error);
        throw error;
    }
};
