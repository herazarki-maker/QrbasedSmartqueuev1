DROP DATABASE IF EXISTS smartqueue;
CREATE DATABASE smartqueue;
USE smartqueue;

-- ==========================================
-- ၁။ roles table (Patient လော့ဂ်အင် အတွက်သာ ချန်ထားမည်)
-- ==========================================
CREATE TABLE roles (
    role_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);
INSERT INTO roles (role_name, description) VALUES ('patient', 'လူနာများအတွက်');

-- ==========================================
-- ၂။ users & patients (လူနာများအတွက် သီးသန့်)
-- ==========================================
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(50) NOT NULL,
    role_id INT UNSIGNED DEFAULT 1, 
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE RESTRICT
);

CREATE TABLE patients (
    p_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    uid VARCHAR(50) UNIQUE NOT NULL, 
    name VARCHAR(100) NOT NULL,
    dob DATE NOT NULL DEFAULT '2000-01-01', 
    gender VARCHAR(10) NOT NULL DEFAULT 'Unknown',
    phone VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    status ENUM('active', 'warning', 'locked') DEFAULT 'active',
    violations_count INT DEFAULT 0,
    locked_reason TEXT DEFAULT NULL,
    locked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX idx_uid ON patients(uid);

-- ==========================================
-- ၃။ doctors table (ဆရာဝန်များ - အခန်းနှင့် အချိန်များ တစ်ခါတည်းပါပြီး)
-- ==========================================
CREATE TABLE doctors (
    dr_id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_code VARCHAR(10) NOT NULL UNIQUE, 
    name VARCHAR(100) NOT NULL,
    specialty VARCHAR(50) NOT NULL,          
    experience VARCHAR(50) NOT NULL, 
    room_number VARCHAR(50) DEFAULT 'Room 1',         
    available_days VARCHAR(100) DEFAULT 'တနင်္လာ မှ သောကြာ',
    working_time VARCHAR(50) DEFAULT '10:00 AM - 12:00 PM',
    status VARCHAR(20) DEFAULT 'active'      
);

INSERT INTO doctors (doctor_code, name, specialty, experience, room_number, available_days, working_time) VALUES 
('MK', 'Dr. Myo Kyaw', 'heart', '15 years', 'Room 1', 'တနင်္လာ, ဗုဒ္ဓဟူး, သောကြာ', '09:00 AM - 01:00 PM'),
('SA', 'Dr. Su Aung', 'heart', '8 years', 'Room 2', 'အင်္ဂါ, ကြာသပတေး, စနေ', '02:00 PM - 05:00 PM'),
('ZM', 'Dr. Zaw Min', 'bone', '12 years', 'Room 3', 'တနင်္ဂနွေ တစ်ရက်တည်း', '10:00 AM - 03:00 PM'),
('KA', 'Dr. Kyaw Aung', 'general', '13 years', 'Room 4', 'နေ့စဉ်', '05:00 PM - 08:00 PM');

-- ==========================================
-- ၄။ staff table (Admin, Counter နှင့် Assistant အားလုံး ပေါင်းထားသော ဇယားသစ်)
-- ==========================================
CREATE TABLE staff (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Counter', 'Doctor Assistant') NOT NULL,
    phone VARCHAR(50) DEFAULT 'N/A',
    dr_id INT NULL, 
    status VARCHAR(50) DEFAULT 'active',
    FOREIGN KEY (dr_id) REFERENCES doctors(dr_id) ON DELETE SET NULL
);

-- ဝန်ထမ်း Data များ တစ်ခါတည်း ထည့်သွင်းခြင်း
INSERT INTO staff (username, password, role, phone, dr_id) VALUES 
('admin', '202608', 'Admin', '09123456789', NULL),
('counter_su', '202608', 'Counter', 'N/A', NULL),        
('counter_zaw', '202608', 'Counter', 'N/A', NULL),    
('asst_zaw', '202608', 'Doctor Assistant', 'N/A', 1),
('asst_aung', '202608', 'Doctor Assistant', 'N/A', 2),
('asst_mya', '202608', 'Doctor Assistant', 'N/A', 3);

-- ==========================================
-- ၅။ appointments & settings (စည်းကမ်းချက်များနှင့် Booking)
-- ==========================================
CREATE TABLE appointments (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_uid VARCHAR(50) NOT NULL,        
    doctor_code VARCHAR(10) NOT NULL,        
    appointment_date DATE NOT NULL,   
    appointment_time TIME DEFAULT '10:00:00',       
    token_number VARCHAR(20) NOT NULL,        
    status VARCHAR(20) DEFAULT 'waiting',    
    prescription TEXT DEFAULT NULL,
    queue_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_code) REFERENCES doctors(doctor_code) ON DELETE CASCADE,
    FOREIGN KEY (patient_uid) REFERENCES patients(uid) ON DELETE CASCADE
);

CREATE TABLE clinic_settings (
    id INT PRIMARY KEY,
    open_time VARCHAR(10),
    close_time VARCHAR(10)
);
INSERT INTO clinic_settings (id, open_time, close_time) VALUES (1, '10:00', '12:30');

CREATE TABLE system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    description VARCHAR(255)
);
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('qr_checkin_open_minutes', '30', 'QR ဖတ်ရန် ခွင့်ပြုမည့် ကြိုတင်အချိန် (မိနစ်)'),
('no_show_threshold_minutes', '15', 'နောက်ကျပါက No-show သတ်မှတ်မည့် အချိန် (မိနစ်)'),
('max_violations_before_lock', '2', 'Account Lock မချမီ ခွင့်ပြုမည့် အကြိမ်အရေအတွက်');

CREATE TABLE patient_violations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_uid VARCHAR(50) NOT NULL,    
    appointment_id INT,                   
    violation_type VARCHAR(50) NOT NULL, 
    action_taken VARCHAR(50),             
    reviewed_by VARCHAR(50),              
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_uid) REFERENCES patients(uid) ON DELETE CASCADE
);
CREATE INDEX idx_patient_uid ON patient_violations(patient_uid);