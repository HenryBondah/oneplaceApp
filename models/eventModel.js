const pool = require('../config/dbConfig');

exports.getAllEvents = async (organizationId) => {
    const query = 'SELECT * FROM school_events WHERE organization_id = $1 ORDER BY event_date';
    const result = await pool.query(query, [organizationId]);
    return result.rows;
};

exports.getEventById = async (eventId, organizationId) => {
    const query = 'SELECT * FROM school_events WHERE id = $1 AND organization_id = $2';
    const result = await pool.query(query, [eventId, organizationId]);
    return result.rows[0];
};

exports.createEvent = async (event) => {
    const query = `
        INSERT INTO school_events (name, event_date, details, organization_id, visibility)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [event.name, event.event_date, event.details, event.organization_id, event.visibility];
    const result = await pool.query(query, values);
    return result.rows[0];
};

exports.updateEvent = async (event) => {
    const query = `
        UPDATE school_events
        SET name = $1, event_date = $2, details = $3, visibility = $4
        WHERE id = $5 AND organization_id = $6 RETURNING *`;
    const values = [event.name, event.event_date, event.details, event.visibility, event.id, event.organization_id];
    const result = await pool.query(query, values);
    return result.rows[0];
};

exports.deleteEvent = async (eventId, organizationId) => {
    const query = 'DELETE FROM school_events WHERE id = $1 AND organization_id = $2 RETURNING *';
    const result = await pool.query(query, [eventId, organizationId]);
    return result.rows[0];
};
