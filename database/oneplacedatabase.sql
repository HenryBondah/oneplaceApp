-- Drop all tables to ensure a clean slate
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;

-- Drop all types to avoid conflicts
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT n.nspname as schema, t.typname as type
              FROM pg_type t
              LEFT JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
              WHERE (t.typname = 'user_role' OR t.typname = 'application_status' OR t.typname = 'attendance_status')
              AND (n.nspname NOT IN ('pg_catalog', 'information_schema'))) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.schema) || '.' || quote_ident(r.type) || ' CASCADE';
    END LOOP;
END $$;

-- Create ENUM types for user roles, application status, and attendance status
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('Admin', 'Mini Admin', 'Manager', 'Supervisor', 'Teacher');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE application_status AS ENUM ('Pending', 'Approved', 'Declined');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('Present', 'Absent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    organization_id SERIAL PRIMARY KEY,
    organization_name VARCHAR(255) NOT NULL,
    organization_address VARCHAR(255) NOT NULL,
    organization_phone VARCHAR(15),
    proof_of_existence_1 VARCHAR(255) NOT NULL,
    proof_of_existence_2 VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    approved BOOLEAN DEFAULT false,
    on_hold BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    review_timestamp TIMESTAMP WITH TIME ZONE,
    deleted BOOLEAN DEFAULT false
);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now(); 
    RETURN NEW; 
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_organizations_modtime
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    account_type user_role NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    class_id INT REFERENCES classes(class_id) ON DELETE SET NULL
);

CREATE TRIGGER update_users_modtime
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Graduation Year Groups Table
CREATE TABLE IF NOT EXISTS graduation_year_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Classes Table
CREATE TABLE IF NOT EXISTS classes (
    class_id SERIAL PRIMARY KEY,
    class_name VARCHAR(255) NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    graduation_year_group_id INT REFERENCES graduation_year_groups(id)
);

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    subject_id SERIAL PRIMARY KEY,
    subject_name VARCHAR(255) NOT NULL,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    grad_year_group_id INT REFERENCES graduation_year_groups(id) ON DELETE CASCADE
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    height DECIMAL(5,2),
    hometown VARCHAR(255),
    image_url VARCHAR(255),
    age INTEGER,
    total_percentage DECIMAL(5,2)
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
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    CONSTRAINT unique_student_guardian UNIQUE (student_id, first_name)
);

-- Student_Subjects Table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS student_subjects (
    student_id INT NOT NULL,
    subject_id INT NOT NULL,
    grade VARCHAR(255),
    PRIMARY KEY (student_id, subject_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Applications Table
CREATE TABLE IF NOT EXISTS applications (
    application_id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    status application_status DEFAULT 'Pending',
    review_timestamp TIMESTAMP WITH TIME ZONE,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reason_for_decline TEXT
);

-- Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
    assessment_id SERIAL PRIMARY KEY,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    weight NUMERIC
);

-- Assessment Results Table
CREATE TABLE IF NOT EXISTS assessment_results (
    result_id SERIAL PRIMARY KEY,
    assessment_id INT REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    score DECIMAL(5,2),
    grade VARCHAR(2),
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    CONSTRAINT unique_student_assessment UNIQUE (student_id, assessment_id)
);

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
    attendance_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status attendance_status,
    marked_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, date)
);

CREATE TRIGGER update_attendance_modtime
    BEFORE UPDATE ON attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Admins Table
CREATE TABLE IF NOT EXISTS admins (
    admin_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Announcements Table
CREATE TABLE IF NOT EXISTS announcements (
    announcement_id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    visibility VARCHAR(10) DEFAULT 'both'
);

-- School Events Table
CREATE TABLE IF NOT EXISTS school_events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    event_date DATE,
    details TEXT,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    visibility VARCHAR(10) DEFAULT 'both'
);

-- School Years Table
CREATE TABLE IF NOT EXISTS school_years (
    id SERIAL PRIMARY KEY,
    year_label VARCHAR(255) NOT NULL,
    current BOOLEAN DEFAULT FALSE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Terms Table
CREATE TABLE IF NOT EXISTS terms (
    term_id SERIAL PRIMARY KEY,
    school_year_id INT NOT NULL REFERENCES school_years(id),
    term_name VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    year_id INT,
    current BOOLEAN DEFAULT FALSE
);

-- Term Classes Table (many-to-many relationship between terms and classes)
CREATE TABLE IF NOT EXISTS term_classes (
    term_id INT NOT NULL,
    class_id INT NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    PRIMARY KEY (term_id, class_id),
    FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE
);

-- Ensure indexes for optimization
CREATE INDEX IF NOT EXISTS idx_user_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_org_name ON organizations (organization_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON classes (class_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON students (first_name, last_name);

-- Unique constraint for attendance records
ALTER TABLE attendance_records
ADD CONSTRAINT unique_attendance_record
UNIQUE (student_id, class_id, date);

-- Organization Images Table
CREATE TABLE IF NOT EXISTS organization_images (
    image_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);

-- Organization Texts Table
CREATE TABLE IF NOT EXISTS organization_texts (
    text_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    heading TEXT NOT NULL,
    paragraph TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);

-- Users Classes Table
CREATE TABLE IF NOT EXISTS user_classes (
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, class_id)
);


-- Ensure user_role ENUM values
DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Teacher';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Supervisor';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


ALTER TABLE announcements ADD COLUMN visibility VARCHAR(10);

CREATE TABLE user_subjects (
    user_id INTEGER REFERENCES users(user_id),
    subject_id INTEGER REFERENCES subjects(subject_id),
    PRIMARY KEY (user_id, subject_id)
);

ALTER TABLE users ADD COLUMN on_hold BOOLEAN DEFAULT FALSE;

ALTER TABLE user_classes ADD COLUMN main BOOLEAN DEFAULT FALSE;

CREATE TABLE report_settings (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL,
    cut_off_point INT DEFAULT 50,
    promoted_class VARCHAR(255) DEFAULT 'Next Class',
    repeated_class VARCHAR(255) DEFAULT 'Same Class',
    school_reopen_date DATE,
    score_remark JSONB,
    teacher_remarks TEXT[]
);


ALTER TABLE students ADD COLUMN grade VARCHAR(2);

UPDATE assessment_results ar
SET title = a.title
FROM assessments a
WHERE ar.assessment_id = a.assessment_id;
ALTER TABLE assessment_results ADD COLUMN title VARCHAR(255);
ALTER TABLE organizations ADD COLUMN logo_path VARCHAR(255);
ALTER TABLE organizations ADD COLUMN font_style VARCHAR(50);
ALTER TABLE students ADD COLUMN gender VARCHAR(10);
