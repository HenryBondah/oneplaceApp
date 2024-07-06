// models/organizationModel.js

exports.createOrganization = async (pool, organization) => {
    const { organizationName, organizationAddress, organizationPhone, userId } = organization;
    const query = `
        INSERT INTO organizations (organization_name, organization_address, organization_phone)
        VALUES ($1, $2, $3)
        RETURNING organization_id, organization_name, organization_address, organization_phone
    `;
    const values = [organizationName, organizationAddress, organizationPhone];

    try {
        const result = await pool.query(query, values);
        const organizationId = result.rows[0].organization_id;
        await pool.query('UPDATE users SET organization_id = $1 WHERE user_id = $2', [organizationId, userId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating organization:', error);
        throw error;
    }
};

exports.findOrganizationById = async (pool, organizationId) => {
    const query = 'SELECT * FROM organizations WHERE organization_id = $1';
    const values = [organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error finding organization by ID:', error);
        throw error;
    }
};

exports.updateOrganization = async (pool, organization) => {
    const { organizationId, organizationName, organizationAddress, organizationPhone } = organization;
    const query = `
        UPDATE organizations
        SET organization_name = $1, organization_address = $2, organization_phone = $3
        WHERE organization_id = $4
        RETURNING organization_id, organization_name, organization_address, organization_phone
    `;
    const values = [organizationName, organizationAddress, organizationPhone, organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating organization:', error);
        throw error;
    }
};

exports.deleteOrganization = async (pool, organizationId) => {
    const query = 'DELETE FROM organizations WHERE organization_id = $1';
    const values = [organizationId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting organization:', error);
        throw error;
    }
};

exports.getAllOrganizations = async (pool) => {
    const query = 'SELECT * FROM organizations';

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all organizations:', error);
        throw error;
    }
};

exports.getOrganizationsWithPendingApplications = async (pool) => {
    const query = `
        SELECT o.*, u.first_name, u.last_name, u.email
        FROM organizations o
        JOIN users u ON o.organization_id = u.organization_id
        WHERE o.approved = false AND o.on_hold = false
    `;

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting organizations with pending applications:', error);
        throw error;
    }
};

exports.updateOrganizationStatus = async (pool, organizationId, status) => {
    const query = `
        UPDATE organizations
        SET approved = $1, on_hold = $2
        WHERE organization_id = $3
        RETURNING organization_id, organization_name, approved, on_hold
    `;
    const values = [status.approved, status.onHold, organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating organization status:', error);
        throw error;
    }
};

exports.restoreOrganization = async (pool, organizationId) => {
    const query = `
        UPDATE organizations
        SET deleted_at = NULL
        WHERE organization_id = $1
        RETURNING organization_id, organization_name, organization_address, organization_phone
    `;
    const values = [organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error restoring organization:', error);
        throw error;
    }
};
