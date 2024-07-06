// models/userModel.js

const bcrypt = require('bcrypt');

exports.createUser = async (pool, user) => {
    const { firstName, lastName, email, password, organizationId } = user;
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `
        INSERT INTO users (first_name, last_name, email, password, organization_id, account_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING user_id, first_name, last_name, email, organization_id, account_type
    `;
    const values = [firstName, lastName, email, hashedPassword, organizationId, 'Admin'];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating user:', error);
        throw error;
    }
};

exports.findUserByEmail = async (pool, email) => {
    const query = 'SELECT * FROM users WHERE email = $1';
    const values = [email];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error finding user by email:', error);
        throw error;
    }
};

exports.findUserById = async (pool, userId) => {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const values = [userId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error finding user by ID:', error);
        throw error;
    }
};

exports.updateUser = async (pool, user) => {
    const { userId, firstName, lastName, email, password } = user;
    let query;
    let values;

    if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        query = `
            UPDATE users
            SET first_name = $1, last_name = $2, email = $3, password = $4
            WHERE user_id = $5
            RETURNING user_id, first_name, last_name, email, organization_id, account_type
        `;
        values = [firstName, lastName, email, hashedPassword, userId];
    } else {
        query = `
            UPDATE users
            SET first_name = $1, last_name = $2, email = $3
            WHERE user_id = $4
            RETURNING user_id, first_name, last_name, email, organization_id, account_type
        `;
        values = [firstName, lastName, email, userId];
    }

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating user:', error);
        throw error;
    }
};

exports.deleteUser = async (pool, userId) => {
    const query = 'DELETE FROM users WHERE user_id = $1';
    const values = [userId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting user:', error);
        throw error;
    }
};

exports.getUsersByOrganization = async (pool, organizationId) => {
    const query = 'SELECT * FROM users WHERE organization_id = $1';
    const values = [organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error getting users by organization:', error);
        throw error;
    }
};
