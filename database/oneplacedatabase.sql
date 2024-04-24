-- Create ENUM types for user roles and application status
CREATE TYPE user_role AS ENUM ('Admin', 'Mini Admin', 'Manager', 'Employee');
CREATE TYPE application_status AS ENUM ('Pending', 'Approved', 'Declined');
CREATE TYPE attendance_status AS ENUM ('Present', 'Absent');

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    account_type user_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Automatic update of the updated_at column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now(); 
    RETURN NEW; 
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_modtime
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    organization_id SERIAL PRIMARY KEY,
    organization_name VARCHAR(255) NOT NULL,
    logo_url VARCHAR(255),
    primary_color VARCHAR(7),  -- Storing as HEX color code
    font_style VARCHAR(100),
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Classes Table
CREATE TABLE IF NOT EXISTS classes (
    class_id SERIAL PRIMARY KEY,
    class_name VARCHAR(255) NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Applications Table
CREATE TABLE IF NOT EXISTS applications (
    application_id SERIAL PRIMARY KEY,
    applicant_email VARCHAR(255) NOT NULL,
    status application_status DEFAULT 'Pending',
    review_timestamp TIMESTAMP WITH TIME ZONE,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reason_for_decline TEXT
);

-- Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
    assessment_id SERIAL PRIMARY KEY,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Assessment Results Table
CREATE TABLE IF NOT EXISTS assessment_results (
    result_id SERIAL PRIMARY KEY,
    assessment_id INT REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    score DECIMAL(5,2),
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
    attendance_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status attendance_status,
    marked_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Admins Table (if necessary)
CREATE TABLE IF NOT EXISTS admins (
    admin_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE
);

-- Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_user_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_org_name ON organizations (organization_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON classes (class_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON students (first_name, last_name);
