drop database if exists smartqueue;
create database smartqueue;
use smartqueue;

-- ==========================================
-- ၁။ roles table (Patient လော့ဂ်အင် အတွက်သာ ချန်ထားမည်)
-- ==========================================
create table roles (
    role_id int unsigned auto_increment primary key,
    role_name varchar(50) not null unique,
    description varchar(255)
);
insert into roles (role_name, description) values ('patient', 'လူနာများအတွက်');

-- ==========================================
-- ၂။ users & patients (လူနာများအတွက် သီးသန့်)
-- ==========================================
create table users (
    user_id int auto_increment primary key,
    username varchar(50) not null unique,
    password varchar(50) not null,
    role_id int unsigned default 1, 
    status varchar(20) default 'active',
    created_at timestamp default current_timestamp,
    foreign key (role_id) references roles(role_id) on delete restrict
);

create table patients (
    p_id int auto_increment primary key,
    user_id int not null,
    uid varchar(50) unique not null, 
    name varchar(100) not null,
    age int not null,
    phone varchar(20) not null,
    address text not null,
    status enum('active', 'warning', 'locked') default 'active',
    violations_count int default 0,
    locked_reason text default null,
    locked_at timestamp null,
    created_at timestamp default current_timestamp,
    foreign key (user_id) references users(user_id) on delete cascade
);
create index idx_uid on patients(uid);

-- ==========================================
-- ၃။ doctors table (ဆရာဝန်များ - အခန်းနှင့် အချိန်များ တစ်ခါတည်းပါပြီး)
-- ==========================================
create table doctors (
    dr_id int auto_increment primary key,
    doctor_code varchar(10) not null unique, 
    name varchar(100) not null,
    specialty varchar(50) not null,          
    experience varchar(50) not null, 
    room_number varchar(50) default 'Room 1',         
    available_days varchar(100) default 'တနင်္လာ မှ သောကြာ',
    working_time varchar(50) default '10:00 AM - 12:00 PM',
    status varchar(20) default 'active'      
);

insert into doctors (doctor_code, name, specialty, experience, room_number, available_days, working_time) values 
('MK', 'Dr. Myo Kyaw', 'heart', '15 years', 'Room 1', 'တနင်္လာ, ဗုဒ္ဓဟူး, သောကြာ', '09:00 AM - 01:00 PM'),
('SA', 'Dr. Su Aung', 'heart', '8 years', 'Room 2', 'အင်္ဂါ, ကြာသပတေး, စနေ', '02:00 PM - 05:00 PM'),
('ZM', 'Dr. Zaw Min', 'bone', '12 years', 'Room 3', 'တနင်္ဂနွေ တစ်ရက်တည်း', '10:00 AM - 03:00 PM'),
('KA', 'Dr. Kyaw Aung', 'general', '13 years', 'Room 4', 'နေ့စဉ်', '05:00 PM - 08:00 PM');

-- ==========================================
-- ၄။ staff table (Admin, Counter နှင့် Assistant အားလုံး ပေါင်းထားသော ဇယားသစ်)
-- ==========================================
create table staff (
    id int auto_increment primary key,
    username varchar(255) not null unique,
    password varchar(255) not null,
    role enum('Admin', 'Counter', 'Doctor Assistant') not null,
    phone varchar(50) default 'N/A',
    dr_id int null, 
    status varchar(50) default 'active',
    foreign key (dr_id) references doctors(dr_id) on delete set null
);

-- ဝန်ထမ်း Data များ တစ်ခါတည်း ထည့်သွင်းခြင်း
insert into staff (username, password, role, phone, dr_id) values 
('admin', '202608', 'Admin', '09123456789', null),
('counter_su', '202608', 'Counter', 'N/A', null),        
('counter_zaw', '202608', 'Counter', 'N/A', null),    
('asst_zaw', '202608', 'Doctor Assistant', 'N/A', 1),
('asst_aung', '202608', 'Doctor Assistant', 'N/A', 2),
('asst_mya', '202608', 'Doctor Assistant', 'N/A', 3);

-- ==========================================
-- ၅။ appointments & settings (စည်းကမ်းချက်များနှင့် Booking)
-- ==========================================
create table appointments (
    appointment_id int auto_increment primary key,
    patient_uid varchar(50) not null,        
    doctor_code varchar(10) not null,        
    appointment_date date not null,   
    appointment_time time default '10:00:00',       
    token_number varchar(20) not null,        
    status varchar(20) default 'waiting',    
    prescription text default null,
    queue_time timestamp default current_timestamp,
    created_at timestamp default current_timestamp,
    foreign key (doctor_code) references doctors(doctor_code) on delete cascade,
    foreign key (patient_uid) references patients(uid) on delete cascade
);

create table clinic_settings (
    id int primary key,
    open_time varchar(10),
    close_time varchar(10)
);
insert into clinic_settings (id, open_time, close_time) values (1, '10:00', '12:30');

create table system_settings (
    id int auto_increment primary key,
    setting_key varchar(100) unique not null,
    setting_value varchar(255) not null,
    description varchar(255)
);
insert into system_settings (setting_key, setting_value, description) values
('qr_checkin_open_minutes', '30', 'QR ဖတ်ရန် ခွင့်ပြုမည့် ကြိုတင်အချိန် (မိနစ်)'),
('no_show_threshold_minutes', '15', 'နောက်ကျပါက No-show သတ်မှတ်မည့် အချိန် (မိနစ်)'),
('max_violations_before_lock', '2', 'Account Lock မချမီ ခွင့်ပြုမည့် အကြိမ်အရေအတွက်');

create table patient_violations (
    id int auto_increment primary key,
    patient_uid varchar(50) not null,    
    appointment_id int,                   
    violation_type varchar(50) not null, 
    action_taken varchar(50),             
    reviewed_by varchar(50),              
    created_at timestamp default current_timestamp,
    foreign key (patient_uid) references patients(uid) on delete cascade
);
create index idx_patient_uid on patient_violations(patient_uid);
ALTER TABLE patients ADD COLUMN gender VARCHAR(10) NOT NULL DEFAULT 'Unknown' AFTER age;
ALTER TABLE patients CHANGE age dob DATE NOT NULL;

ALTER TABLE patients DROP COLUMN age;
ALTER TABLE patients ADD COLUMN dob DATE NOT NULL DEFAULT '2000-01-01' AFTER name;