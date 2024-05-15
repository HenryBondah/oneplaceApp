-- -- Create ENUM types for user roles and application status
-- CREATE TYPE user_role AS ENUM ('Admin', 'Mini Admin', 'Manager', 'Employee');
-- CREATE TYPE application_status AS ENUM ('Pending', 'Approved', 'Declined');
-- CREATE TYPE attendance_status AS ENUM ('Present', 'Absent');

-- -- Users Table
-- CREATE TABLE IF NOT EXISTS users (
--     user_id SERIAL PRIMARY KEY,
--     first_name VARCHAR(255) NOT NULL,
--     last_name VARCHAR(255) NOT NULL,
--     email VARCHAR(255) UNIQUE NOT NULL,
--     password VARCHAR(255) NOT NULL,
--     account_type user_role NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Automatic update of the updated_at column
-- CREATE OR REPLACE FUNCTION update_modified_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = now(); 
--     RETURN NEW; 
-- END;
-- $$ language 'plpgsql';

-- CREATE TRIGGER update_users_modtime
--     BEFORE UPDATE ON users
--     FOR EACH ROW
--     EXECUTE FUNCTION update_modified_column();

-- -- Organizations Table
-- CREATE TABLE IF NOT EXISTS organizations (
--     organization_id SERIAL PRIMARY KEY,
--     organization_name VARCHAR(255) NOT NULL,
--     logo_url VARCHAR(255),
--     primary_color VARCHAR(7),  -- Storing as HEX color code
--     font_style VARCHAR(100),
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );

-- -- Classes Table
-- CREATE TABLE IF NOT EXISTS classes (
--     class_id SERIAL PRIMARY KEY,
--     class_name VARCHAR(255) NOT NULL,
--     organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );

-- -- Subjects Table
-- CREATE TABLE IF NOT EXISTS subjects (
--     subject_id SERIAL PRIMARY KEY,
--     subject_name VARCHAR(255) NOT NULL,
--     class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );


-- -- Students Table
-- CREATE TABLE IF NOT EXISTS students (
--     student_id SERIAL PRIMARY KEY,
--     first_name VARCHAR(255) NOT NULL,
--     last_name VARCHAR(255) NOT NULL,
--     date_of_birth DATE,
--     class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );

-- -- Applications Table
-- CREATE TABLE IF NOT EXISTS applications (
--     application_id SERIAL PRIMARY KEY,
--     applicant_email VARCHAR(255) NOT NULL,
--     status application_status DEFAULT 'Pending',
--     review_timestamp TIMESTAMP WITH TIME ZONE,
--     reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
--     reason_for_decline TEXT
-- );

-- -- Assessments Table
-- CREATE TABLE IF NOT EXISTS assessments (
--     assessment_id SERIAL PRIMARY KEY,
--     class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
--     title VARCHAR(255) NOT NULL,
--     description TEXT,
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );

-- -- Assessment Results Table
-- CREATE TABLE IF NOT EXISTS assessment_results (
--     result_id SERIAL PRIMARY KEY,
--     assessment_id INT REFERENCES assessments(assessment_id) ON DELETE CASCADE,
--     student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
--     score DECIMAL(5,2),
--     created_by INT REFERENCES users(user_id) ON DELETE SET NULL
-- );

-- -- Attendance Records Table
-- CREATE TABLE IF NOT EXISTS attendance_records (
--     attendance_id SERIAL PRIMARY KEY,
--     student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
--     class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
--     date DATE NOT NULL,
--     status attendance_status,
--     marked_by INT REFERENCES users(user_id) ON DELETE SET NULL,
--     UNIQUE (student_id, date)  -- Add a unique constraint
-- );

-- -- Admins Table (if necessary)
-- CREATE TABLE IF NOT EXISTS admins (
--     admin_id SERIAL PRIMARY KEY,
--     user_id INT REFERENCES users(user_id) ON DELETE CASCADE
-- );

-- ALTER TABLE attendance_records
-- ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- CREATE TRIGGER update_attendance_modtime
-- BEFORE UPDATE ON attendance_records
-- FOR EACH ROW
-- EXECUTE FUNCTION update_modified_column();

-- ALTER TABLE attendance_records
-- ADD COLUMN marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
-- ALTER TABLE attendance_records ADD CONSTRAINT unique_student_date UNIQUE (student_id, date);
-- ALTER TABLE assessments ADD COLUMN subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE;

-- ALTER TABLE assessment_results
-- ADD CONSTRAINT unique_student_assessment
-- UNIQUE (student_id, assessment_id);

-- -- Assuming the students table already exists, and adding more fields
-- ALTER TABLE students ADD COLUMN height DECIMAL(5,2);
-- ALTER TABLE students ADD COLUMN hometown VARCHAR(255);
-- ALTER TABLE students ADD COLUMN image_url VARCHAR(255);

-- -- Guardians Table
-- CREATE TABLE guardians (
--     guardian_id SERIAL PRIMARY KEY,
--     first_name VARCHAR(255) NOT NULL,
--     last_name VARCHAR(255) NOT NULL,
--     address VARCHAR(255),
--     phone VARCHAR(15),
--     hometown VARCHAR(255),
--     image_url VARCHAR(255),
--     student_id INT,
--     FOREIGN KEY (student_id) REFERENCES students(student_id)
-- );

-- -- Student_Subjects Table to link students and subjects (many-to-many)
-- CREATE TABLE student_subjects (
--     student_id INT,
--     subject_id INT,
--     FOREIGN KEY (student_id) REFERENCES students(student_id),
--     FOREIGN KEY (subject_id) REFERENCES subjects(subject_id),
--     PRIMARY KEY (student_id, subject_id)
-- );

-- ALTER TABLE students
-- ADD COLUMN age INTEGER;

-- ALTER TABLE student_subjects ADD COLUMN grade VARCHAR(255);


-- -- Indexes for optimization
-- CREATE INDEX IF NOT EXISTS idx_user_email ON users (email);
-- CREATE INDEX IF NOT EXISTS idx_org_name ON organizations (organization_name);
-- CREATE INDEX IF NOT EXISTS idx_class_name ON classes (class_name);
-- CREATE INDEX IF NOT EXISTS idx_student_name ON students (first_name, last_name);


-- Create ENUM types for user roles and application status
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

-- Trigger to update 'updated_at' column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now(); 
    RETURN NEW; 
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_users_modtime
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    organization_id SERIAL PRIMARY KEY,
    organization_name VARCHAR(255) NOT NULL,
    logo_url VARCHAR(255),
    primary_color VARCHAR(7), -- Storing as HEX color code
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

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    subject_id SERIAL PRIMARY KEY,
    subject_name VARCHAR(255) NOT NULL,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    height DECIMAL(5,2),
    hometown VARCHAR(255),
    image_url VARCHAR(255),
    age INTEGER
);

-- Guardians Table
CREATE TABLE IF NOT EXISTS guardians (
    guardian_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(15),
    hometown VARCHAR(255),
    image_url VARCHAR(255),
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE
);

-- Student_Subjects Table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS student_subjects (
    student_id INT NOT NULL,
    subject_id INT NOT NULL,
    grade VARCHAR(255),
    PRIMARY KEY (student_id, subject_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
);

-- Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
    assessment_id SERIAL PRIMARY KEY,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE,
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
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    UNIQUE (student_id, assessment_id)
);

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
    attendance_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status attendance_status,
    marked_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, date)
);


-- Announcements Table
CREATE TABLE IF NOT EXISTS announcements (
    announcement_id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS school_events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    event_date DATE,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS school_years (
    id SERIAL PRIMARY KEY,
    year_label VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE graduation_year_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);
ALTER TABLE classes
ADD COLUMN graduation_year_group_id INT REFERENCES graduation_year_groups(id);

CREATE TABLE student_subjects (
    student_id INTEGER,
    subject_id INTEGER,
    PRIMARY KEY (student_id, subject_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
);

ALTER TABLE guardians ADD CONSTRAINT unique_student_guardian UNIQUE (student_id, first_name);

ALTER TABLE assessments
ADD COLUMN weight NUMERIC;

ALTER TABLE assessment_results ADD COLUMN grade VARCHAR(2);

ALTER TABLE students ADD COLUMN total_percentage DECIMAL(5, 2);


-- Indexes for quicker search
CREATE INDEX IF NOT EXISTS idx_user_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_org_name ON organizations (organization_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON classes (class_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON students (first_name, last_name);
