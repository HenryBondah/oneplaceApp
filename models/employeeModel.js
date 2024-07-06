// models/employeeModel.js

exports.createEmployee = async (pool, employeeData) => {
    const query = `
        INSERT INTO employees (name, department, position, salary)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `;
    const values = [
        employeeData.name,
        employeeData.department,
        employeeData.position,
        employeeData.salary
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating employee:', error);
        throw error;
    }
};

exports.getEmployeeById = async (pool, employeeId) => {
    const query = `
        SELECT *
        FROM employees
        WHERE employee_id = $1
    `;
    const values = [employeeId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting employee by ID:', error);
        throw error;
    }
};

exports.getAllEmployees = async (pool) => {
    const query = `
        SELECT *
        FROM employees
    `;

    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting all employees:', error);
        throw error;
    }
};

exports.updateEmployee = async (pool, employeeId, employeeData) => {
    const query = `
        UPDATE employees
        SET name = $1, department = $2, position = $3, salary = $4
        WHERE employee_id = $5
        RETURNING *
    `;
    const values = [
        employeeData.name,
        employeeData.department,
        employeeData.position,
        employeeData.salary,
        employeeId
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating employee:', error);
        throw error;
    }
};

exports.deleteEmployee = async (pool, employeeId) => {
    const query = 'DELETE FROM employees WHERE employee_id = $1';
    const values = [employeeId];

    try {
        await pool.query(query, values);
    } catch (error) {
        console.error('Error deleting employee:', error);
        throw error;
    }
};
