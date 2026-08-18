const mysql = require('mysql2'); // (တကယ်လို့ မင်းက mysql2 သုံးထားရင် require('mysql2') လို့ ရေးပါ)
require('dotenv').config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    timezone: '+06:30',
    ssl: {
        rejectUnauthorized: false // <--- ဒါလေး မဖြစ်မနေ ထည့်ပေးရပါမယ်
    }
});
const express = require("express");
const http = require('http');
const { Server } = require("socket.io");
const app = express();
app.use(express.json());
const PORT = 3000;
// 💡 (အသစ်) Doctor များ Queue စ/မစ မှတ်သားထားမည့် နေရာ
const activeQueues = {};
// public folder ကို browser က access လုပ်ခွင့်ပေးမယ်
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

// Express App ကို HTTP Server အဖြစ် ပြောင်းပြီး Socket.io နဲ့ ချိတ်ခြင်း
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
    console.log('A user connected with Socket.io');
});
// 🌟 မည်သည့် OS တွင်မဆို YYYY-MM-DD (မြန်မာစံတော်ချိန်) အတိအကျ ထုတ်ပေးမည့် Function 
function getTodayDate() {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" }));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; // "2026-08-16" အတိအကျ ထွက်ပါမည်
}
// 🌟 (အသစ်) ဆေးခန်းပိတ်ချိန် ရောက်/မရောက် စစ်ဆေးပေးမည့် Function
function isClinicClosed(closeTimeStr) {
    if (!closeTimeStr) return false;
    
    // မြန်မာစံတော်ချိန်ကို ယူမည်
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" }));
    const currentHour = d.getHours(); 
    const currentMin = d.getMinutes(); 
    
    // Database ထဲက အချိန် (ဥပမာ "17:30") ကို နာရီ နဲ့ မိနစ် ခွဲထုတ်မည်
    const timeParts = closeTimeStr.split(':');
    if (timeParts.length < 2) return false;
    
    let closeHour = parseInt(timeParts[0].trim(), 10);
    const closeMin = parseInt(timeParts[1].trim(), 10);
    
    // ညနေပိုင်း PM တွေပါလာရင် 24 Hour Format ပြောင်းပေးရန်
    const timeStrLower = closeTimeStr.toLowerCase();
    if (timeStrLower.includes('pm') && closeHour < 12) closeHour += 12;
    if (timeStrLower.includes('am') && closeHour === 12) closeHour = 0;
    
    // ပိတ်ချိန် နာရီထက် ကျော်သွားရင် (သို့) နာရီတူပြီး မိနစ်ကျော်သွားရင် True (ပိတ်ပြီ) လို့ သတ်မှတ်မည်
    if (currentHour > closeHour) return true;
    if (currentHour === closeHour && currentMin >= closeMin) return true;
    
    return false;
}
// ==========================================
// User Login API 
// ==========================================
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    // ==========================================
    // ၁။ STAFF ဇယားတွင် အရင်ရှာမည် (Admin, Counter, Doctor Assistant များအတွက်)
    // ==========================================
    const sqlStaff = `
        SELECT s.id, s.username, s.role, s.status, s.dr_id, d.name AS doctor_name, d.doctor_code 
        FROM staff s
        LEFT JOIN doctors d ON s.dr_id = d.dr_id
        WHERE s.username = ? AND s.password = ?
    `;

    db.query(sqlStaff, [username, password], (err, staffResults) => {
        if (err) {
            console.error("Login Staff DB Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }

        if (staffResults.length > 0) {
            const staff = staffResults[0];

            // Inactive ဖြစ်နေလျှင် ပေးမဝင်ပါ
            if (staff.status !== 'active') {
                return res.json({ success: false, message: "Your account is suspended by Admin." });
            }

            // 🌟 Staff Login အောင်မြင်ပါက
            return res.json({ 
                success: true, 
                role: staff.role, // 'Admin', 'Counter', သို့မဟုတ် 'Doctor Assistant' ပြန်ထွက်မည်
                doctorName: staff.doctor_name || null, 
                doctorCode: staff.doctor_code || null, 
                message: "Login Successful" 
            });
            
        } else {
            // ==========================================
            // ၂။ STAFF ထဲမှာ မတွေ့ရင် PATIENTS (users + patients ဇယား) ထဲ ဆက်ရှာမည်
            // ==========================================
            const sqlPatient = `
                SELECT u.user_id, u.username, u.status AS user_status, p.status AS patient_status, p.uid 
                FROM users u 
                JOIN patients p ON u.user_id = p.user_id
                WHERE u.username = ? AND u.password = ?
            `;
            
            db.query(sqlPatient, [username, password], (err, patientResults) => {
                if (err) {
                    console.error("Login Patient DB Error:", err);
                    return res.json({ success: false, message: "Database Error" });
                }

                if (patientResults.length > 0) {
                    const user = patientResults[0];

                    // 🚨🚨 Patient ဖြစ်ပြီး Locked ဖြစ်နေပါက လုံးဝ ဝင်ခွင့်မပြုပါ
                    if (user.patient_status === 'locked') {
                        return res.json({ 
                            success: false,
                            isLocked: true, 
                            message: "Your account is currently locked by the violation of rules. Please contact Admin." 
                        });
                    }

                    // 🌟 Patient Login အောင်မြင်ပါက
                    return res.json({ 
                        success: true, 
                        role: 'patient', // Frontend အတွက် patient ဟု သတ်မှတ်ပေးမည်
                        patientStatus: user.patient_status, 
                        uid: user.uid, // 🌟 UID ပါ တစ်ခါတည်း သယ်သွားမည်
                        message: "Login Successful" 
                    });
                } else {
                    // ဘယ်ဇယားမှာမှ မတွေ့ပါက
                    return res.json({ success: false, message: "Invalid Username or Password" });
                }
            });
        }
    });
});

// လူနာအသစ် Account ဖန်တီးရန် API
app.post("/create-patient", (req, res) => {
    // 🌟 gender ကိုပါ လှမ်းဖမ်းမည်
    const { name, dob, gender, phone, address, password } = req.body; 

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const uidPrefix = `UID${year}${month}${day}`;

    const checkSql = "SELECT username FROM users WHERE username LIKE ? ORDER BY user_id DESC LIMIT 1";
    
    db.query(checkSql, [`${uidPrefix}%`], (err, result) => {
        if (err) return res.json({ success: false, message: "Database Error" });

        let newCount = 1; 
        if (result.length > 0) {
            const lastUid = result[0].username;
            const lastCount = parseInt(lastUid.slice(-3)); 
            newCount = lastCount + 1;
        }
        
        const newUid = uidPrefix + String(newCount).padStart(3, '0');

        const insertUserSql = "INSERT INTO users (username, password, role_id) VALUES (?, ?, 1)";
        db.query(insertUserSql, [newUid, password], (err, userResult) => {
            if (err) return res.json({ success: false, message: "User Account ဖန်တီး၍ မရပါ။" });

            const userId = userResult.insertId;
            
            // 🌟 patients ဇယားထဲသို့ သွင်းရာတွင် gender နှင့် ? တစ်ခု ထပ်တိုးပါသည်
            const insertPatientSql = "INSERT INTO patients (user_id, uid, name, dob, gender, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)";
            
            db.query(insertPatientSql, [userId, newUid, name, dob, gender, phone, address], (err, patientResult) => {
                if (err) {
                    console.error("Insert Patient Error:", err);
                    return res.json({ success: false, message: "လူနာအချက်အလက် သိမ်းဆည်း၍ မရပါ။" });
                }
                io.emit("update_patient_list");
                return res.json({ success: true, message: "Account ဖန်တီးမှု အောင်မြင်ပါသည်။", uid: newUid });
            });
        });
    });
});
// လူနာ၏ Password ကို Reset ပြုလုပ်ရန် API
app.post("/reset-password", (req, res) => {
    const { username, newPassword } = req.body;
    const sql = "UPDATE users SET password = ? WHERE username = ? AND role_id = 1";
    
    db.query(sql, [newPassword, username], (err, result) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        if (result.affectedRows > 0) {
            return res.json({ success: true, message: "Password အသစ် ပြောင်းလဲခြင်း အောင်မြင်ပါသည်။" });
        } else {
            return res.json({ success: false, message: "ရှာမတွေ့ပါ။ (UID မှားနေခြင်း သို့မဟုတ် လူနာအကောင့် မဟုတ်ပါ)" });
        }
    });
});
// ==========================================
// Patient - ဆရာဝန်စာရင်း အားလုံးကို ဆွဲထုတ်မည့် API
// ==========================================
app.get("/api/doctors", (req, res) => {
    db.query("SELECT * FROM doctors", (err, results) => {
        if (err) {
            console.error("Error fetching doctors:", err);
            return res.json({ success: false, message: "Database Error" });
        }
        res.json({ success: true, doctors: results });
    });
});

// ==========================================
// ရွေးချယ်လိုက်သော ဌာနအလိုက် ဆရာဝန်များ ဆွဲထုတ်မည့် API
// ==========================================
app.get("/api/doctors/:specialty", (req, res) => {
    const specialty = req.params.specialty;
    
    // Date ကို အတိအကျယူမည်
    const exactToday = getTodayDate(); 

    console.log("🔍 ရှာဖွေနေသော ဌာန:", specialty, "ရက်စွဲ အတိအကျ:", exactToday);

    const sql = `
        SELECT d.doctor_code as id, d.name, d.experience, d.available_days, d.working_time, d.room_number, COUNT(a.token_number) as booked_count 
        FROM doctors d
        LEFT JOIN appointments a ON d.doctor_code = a.doctor_code AND a.appointment_date = ? AND a.status != 'cancelled'
        WHERE d.specialty = ?
        GROUP BY d.doctor_code
    `;

    db.query(sql, [exactToday, specialty], (err, results) => {
        if (err) {
            console.error("Doctor Fetch Error:", err);
            // 🚨 ဤ return ပါမှသာ အောက်သို့ ဆက်မသွားဘဲ ရပ်တန့်မည်
            return res.json({ success: false, message: "Database Error" });
        }
        
        // 🚨 ဤနေရာတွင်သာ Data ကို တစ်ကြိမ်တည်း ပြန်ပို့ပါမည်
        res.json({ success: true, doctors: results });
    });
});
// 🌟 RACE CONDITION ကာကွယ်ရန် UID များကို ခဏ သော့ခတ်ထားမည့် နေရာ
const bookingLocks = new Set();

// 🌟 လူနာ (သို့) Assistant ဘက်မှ Booking တင်မည့် API
app.post('/api/book-appointment', (req, res) => {
    const { uid, doctor_code, date } = req.body; 

    if (!uid || !doctor_code || !date) {
        return res.json({ success: false, message: "အချက်အလက် မပြည့်စုံပါ။ ရက်စွဲ ရွေးချယ်ရန် လိုအပ်ပါသည်။" });
    }

    if (bookingLocks.has(uid)) {
        return res.json({ success: false, message: "စနစ်က အလုပ်လုပ်နေဆဲဖြစ်ပါသည်။ ခဏစောင့်ပြီးမှ ပြန်ကြိုးစားပါ။" });
    }

    bookingLocks.add(uid);

    const sendResponse = (data) => {
        bookingLocks.delete(uid); 
        return res.json(data);
    };

    // 🌟 ၁။ ဆေးခန်းပိတ်/မပိတ် အရင်စစ်မည်
    db.query("SELECT close_time FROM clinic_settings WHERE id = 1", (err, setRes) => {
        let clinicCloseTime = '17:00'; // Default ညနေ ၅ နာရီ
        if (!err && setRes.length > 0 && setRes[0].close_time) {
            clinicCloseTime = setRes[0].close_time;
        }

        const exactToday = getTodayDate();
        // ယနေ့အတွက် Booking တင်တာဖြစ်ပြီး၊ ဆေးခန်းလည်း ပိတ်သွားပြီဆိုရင် လက်မခံပါ
        if (date === exactToday && isClinicClosed(clinicCloseTime)) {
            return sendResponse({ success: false, message: "⚠️ တောင်းပန်ပါသည်။ ယနေ့အတွက် ဆေးခန်းပိတ်သွားပြီဖြစ်၍ Booking ထပ်တင်ခွင့်မရှိတော့ပါ။ မနက်ဖြန်အတွက်သာ ရက်စွဲရွေးချယ်ပြီး တင်ပေးပါ။" });
        }

        // ၂။ မူလ Booking အကြိမ်ရေ စစ်ဆေးမည့်အပိုင်း ဆက်လုပ်မည်
        const checkLimitSql = "SELECT COUNT(*) as total_booked FROM appointments WHERE patient_uid = ? AND appointment_date = ?";
        
        db.query(checkLimitSql, [uid, date], (err, limitRes) => {
            if (err) return sendResponse({ success: false, message: "Database Error" });

            if (limitRes[0].total_booked >= 3) {
                return sendResponse({ 
                    success: false, 
                    message: "⚠️ သင်သည် ယနေ့အတွက် Booking တင်ခွင့် အကြိမ်ရေ (၃) ကြိမ် ပြည့်သွားပါပြီ။\n(ထပ်မံတင်လိုပါက မနက်ဖြန်မှ ပြန်လည်ကြိုးစားပါ။)" 
                });
            }

            const checkSql = "SELECT Appointment_id FROM appointments WHERE patient_uid = ? AND appointment_date = ? AND status = 'waiting'";
            
            db.query(checkSql, [uid, date], (err, results) => {
                if (err) return sendResponse({ success: false, message: "Database Error" });

                if (results.length > 0) {
                    return sendResponse({ success: false, message: "ရွေးချယ်ထားသော ရက်စွဲအတွက် လူကြီးမင်း၏ Booking ရှိနှင့်ပြီး ဖြစ်ပါသည်။" });
                }

                const countSql = "SELECT COUNT(*) as count FROM appointments WHERE doctor_code = ? AND appointment_date = ?";
                
                db.query(countSql, [doctor_code, date], (err, countResult) => {
                    if (err) return sendResponse({ success: false, message: "Token တွက်ချက်ရာတွင် အမှားဖြစ်နေပါသည်။" });

                    const nextNumber = countResult[0].count + 1;
                    const tokenString = doctor_code + nextNumber.toString().padStart(3, '0');

                    db.query("SELECT open_time FROM clinic_settings WHERE id = 1", (err, timeRes) => {
                        let clinicStartTime = '10:00:00'; 
                        if (timeRes && timeRes.length > 0 && timeRes[0].open_time) {
                            clinicStartTime = timeRes[0].open_time; 
                        }

                        const insertSql = "INSERT INTO appointments (patient_uid, doctor_code, appointment_date, appointment_time, status, token_number) VALUES (?, ?, ?, ?, 'waiting', ?)";
                        
                        db.query(insertSql, [uid, doctor_code, date, clinicStartTime, tokenString], (err) => {
                            if (err) {
                                console.error("Booking Insert Error:", err);
                                return sendResponse({ success: false, message: "Booking တင်၍ မရပါ။" });
                            }

                            io.emit("update_queue");
                            sendResponse({ success: true, message: "Booking ကို အောင်မြင်စွာ တင်ပြီးပါပြီ။", token: tokenString });
                        });
                    });
                });
            });
        });
    });
});
// ==========================================
// လူနာ Profile (Status နှင့် အသက်တွက်ချက်မှု ပါဝင်သည်)
// ==========================================
app.get("/api/patient-profile/:uid", (req, res) => {
    const uid = req.params.uid;
    
    // 🌟 MySQL ကို အသုံးပြု၍ dob မှနေ၍ လက်ရှိအသက် (age) ကို အလိုအလျောက် တွက်ထုတ်ခိုင်းမည်
    const sql = "SELECT name, dob, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age, uid, status FROM patients WHERE uid = ?";
    
    db.query(sql, [uid], (err, result) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        if (result.length > 0) {
            res.json({ success: true, profile: result[0] });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    });
});

// =================================================================
// 🌟 2. SYSTEM RULES: QR Check-in အချိန်စောလွန်းသူများကို တားဆီးခြင်း
// =================================================================
app.post('/api/check-in', (req, res) => {
    const { uid, qr_text } = req.body;

    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" }));
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const current_myanmar_time = `${today} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

    const clean_qr_text = qr_text.trim(); 
    const qrParts = clean_qr_text.split('_'); 
    
    if (qrParts.length !== 3 || qrParts[0] !== 'QR') {
        return res.json({ success: false, errorType: 'NOT_FOUND', message: "QR Code ပုံစံ မမှန်ကန်ပါ။" });
    }

    if (qrParts[2] !== today) {
        return res.json({ success: false, errorType: 'NOT_FOUND', message: "ဤ QR Code သည် သက်တမ်းကုန်သွားပါပြီ (သို့) ရက်စွဲ မမှန်ကန်ပါ။" });
    }

    // 🌟 (အသစ်) ဆေးခန်းပိတ်သွားခြင်း ရှိ/မရှိ အရင်စစ်မည်
    db.query("SELECT close_time FROM clinic_settings WHERE id = 1", (err, closeRes) => {
        let clinicCloseTime = '17:00'; 
        if (!err && closeRes.length > 0 && closeRes[0].close_time) {
            clinicCloseTime = closeRes[0].close_time;
        }

        if (isClinicClosed(clinicCloseTime)) {
            return res.json({ success: false, errorType: 'CLOSED', message: "⚠️ ယနေ့အတွက် ဆေးခန်းပိတ်သွားပြီဖြစ်၍ Check-in ဝင်ခွင့်မပြုတော့ပါ။" });
        }

        // မူလရှိပြီးသား Check-in Process ဆက်လုပ်မည်
        db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'qr_checkin_open_minutes'", (err, setRes) => {
            let earlyLimit = 30; // Default (၃၀ မိနစ်)
            if (setRes && setRes.length > 0) earlyLimit = parseInt(setRes[0].setting_value);

            const checkSql = `
                SELECT Appointment_id, 
                       TIMESTAMPDIFF(MINUTE, ?, CONCAT(appointment_date, ' ', appointment_time)) AS mins_left
                FROM appointments 
                WHERE patient_uid = ? AND doctor_code = ? AND appointment_date = ? AND status = 'waiting'
            `;
            
            db.query(checkSql, [current_myanmar_time, uid, qrParts[1], today], (err, result) => {
                if (err) return res.json({ success: false, errorType: 'NOT_FOUND', message: "Database Error" });

                if (result.length === 0) {
                    return res.json({ 
                        success: false, 
                        errorType: 'NOT_FOUND', 
                        message: "လူကြီးမင်းသည် ဤဆရာဝန်ထံတွင် Booking မရှိပါ (သို့) မှားယွင်းသော အခန်းရှေ့သို့ ရောက်နေပါသည်။" 
                    });
                }

                const minsLeft = result[0].mins_left;

                if (minsLeft > earlyLimit) {
                    return res.json({ 
                        success: false, 
                        errorType: 'TOO_EARLY', 
                        message: `စောလွန်းနေပါသည်။ သင့် Booking အချိန်မတိုင်မီ ${earlyLimit} မိနစ်အလိုမှသာ Check-in ဝင်၍ ရပါမည်။` 
                    });
                }

                const updateSql = "UPDATE appointments SET status = 'arrived' WHERE Appointment_id = ?";
                db.query(updateSql, [result[0].Appointment_id], (err) => {
                    if (err) return res.json({ success: false, errorType: 'NOT_FOUND', message: "Update Error" });

                    io.emit("update_queue"); 

                    db.query("SELECT token_number FROM appointments WHERE Appointment_id = ?", [result[0].Appointment_id], (err, tokenResult) => {
                        if (tokenResult.length > 0) {
                            res.json({ success: true, message: "Check-in အောင်မြင်ပါသည်။", patient_token: tokenResult[0].token_number });
                        } else {
                            res.json({ success: false, errorType: 'NOT_FOUND', message: "Token အား ရှာမတွေ့ပါ။" });
                        }
                    });
                });
            });
        });
    });
});

// လူနာ၏ ဆေးမှတ်တမ်း (History) ကို ဆွဲယူမည့် API
app.get("/api/patient-history/:uid", (req, res) => {
    const sql = `
        SELECT appointment_date, token_number, doctor_code, prescription 
        FROM appointments 
        WHERE patient_uid = ? AND status = 'completed'
        ORDER BY appointment_date DESC
    `;
    db.query(sql, [req.params.uid], (err, results) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        res.json({ success: true, history: results });
    });
});
// 🌟 Assistant ဘက်မှ Live တန်းစီစာရင်း လှမ်းကြည့်မည့် API
app.get('/api/assistant/queue/:doctor_code', (req, res) => {
    const doctor_code = req.params.doctor_code;
    
    const sql = `
        SELECT a.*, p.name AS patient_name 
        FROM appointments a
        LEFT JOIN patients p ON a.patient_uid = p.uid
        WHERE a.doctor_code = ? AND a.appointment_date = CURDATE()
        ORDER BY 
            CASE WHEN a.status = 'skipped' THEN 1 ELSE 0 END, 
            a.token_number ASC
    `;

    db.query(sql, [doctor_code], (err, results) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        res.json({ success: true, queue: results });
    });
});

// 🌟 Assistant ဘက်မှ ရက်စွဲရွေး၍ တန်းစီစာရင်း လှမ်းကြည့်မည့် API
app.get('/api/assistant/view-queue/:doctor_code/:date', (req, res) => {
    const { doctor_code, date } = req.params;

    const sql = `
        SELECT a.*, p.name AS patient_name 
        FROM appointments a
        LEFT JOIN patients p ON a.patient_uid = p.uid
        WHERE a.doctor_code = ? AND a.appointment_date = ?
        ORDER BY 
            CASE WHEN a.status = 'skipped' THEN 1 ELSE 0 END,
            a.token_number ASC
    `;

    db.query(sql, [doctor_code, date], (err, results) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        res.json({ success: true, appointments: results });
    });
});

// ==========================================
// Assistant Skip & Complete APIs
// ==========================================
app.post("/api/assistant/skip", (req, res) => {
    const { appointment_id } = req.body;
    
    // 🌟 အချိန်ကို မပြောင်းတော့ဘဲ status ကို 'skipped' လို့ တိုက်ရိုက် ပြောင်းလိုက်ပါမည်
    const sql = "UPDATE appointments SET status = 'skipped' WHERE Appointment_id = ?";
    
    db.query(sql, [appointment_id], (err, result) => {
        if (err) return res.json({ success: false });
        io.emit("update_queue"); 
        res.json({ success: true, message: "Skip လုပ်ပြီး နောက်ဆုံးသို့ ပို့လိုက်ပါပြီ။" });
    });
});
// ==========================================
// Assistant - နောက်လူနာကို ခေါ်မည့် API (Call Next)
// ==========================================
app.post("/api/assistant/call", (req, res) => {
    const { appointment_id, token_number, doctor_code } = req.body;
    
    // လူနာကို 'arrived' အခြေအနေမှ 'consulting' (ဆရာဝန်ခန်းထဲတွင်) သို့ ပြောင်းမည်
    const sql = "UPDATE appointments SET status = 'consulting' WHERE Appointment_id = ?";
    db.query(sql, [appointment_id], (err) => {
        if (err) return res.json({ success: false });
        
        // 🌟 နောက်ပိုင်း TV Screen ပေါ်မှာ အသံနဲ့ခေါ်ဖို့ Socket ကို တစ်ခါတည်း လွှတ်ထားပေးမည်
        io.emit("call_next_patient", { token_number, doctor_code });
        io.emit("update_queue"); 
        
        res.json({ success: true });
    });
});
app.post("/api/assistant/complete", (req, res) => {
    const { appointment_id, prescription } = req.body;
    const sql = "UPDATE appointments SET status = 'completed', prescription = ? WHERE Appointment_id = ?";
    db.query(sql, [prescription, appointment_id], (err, result) => {
        if (err) return res.json({ success: false });
        io.emit("update_queue"); 
        res.json({ success: true, message: "ဆေးစာ သိမ်းဆည်းပြီးပါပြီ။" });
    });
});
// Settings API
app.get("/api/settings", (req, res) => {
    db.query("SELECT * FROM clinic_settings WHERE id = 1", (err, result) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, settings: result[0] });
    });
});

app.post("/api/settings/update", (req, res) => {
    const { open_time, close_time } = req.body;
    db.query("UPDATE clinic_settings SET open_time = ?, close_time = ? WHERE id = 1", [open_time, close_time], (err) => {
        if (err) return res.json({ success: false, message: "Error" });
        res.json({ success: true, message: "အချိန် ပြောင်းလဲသတ်မှတ်ပြီးပါပြီ။" });
    });
});

// ==========================================
// Current Token API (လက်ရှိ ကုသနေသော နံပါတ်ကို ပြရန်)
// ==========================================
app.get("/api/current-token/:docCode", (req, res) => {
    const docCode = req.params.docCode;
    const exactToday = getTodayDate(); 

    // 🌟 အခန်းထဲရောက်နေသူ (consulting) ရှိ/မရှိ နဲ့ ပြီးသွားသူ (completed) ရှိ/မရှိ ကိုပါ ရှာမည်
    const sql = `
        SELECT status, token_number FROM appointments 
        WHERE doctor_code = ? AND appointment_date = ? AND status IN ('consulting', 'completed')
        ORDER BY FIELD(status, 'consulting', 'completed'), Appointment_id DESC 
        LIMIT 1
    `;
    
    db.query(sql, [docCode, exactToday], (err, results) => {
        if (err) return res.json({ success: false, current_token: "-" });

        // (၁) လောလောဆယ် အခန်းထဲမှာ ပြနေတဲ့သူ (consulting) ရှိရင် အဲ့ဒီ Token ကို ပြမည်
        if (results.length > 0 && results[0].status === 'consulting') {
            activeQueues[docCode] = true; // Server အိပ်သွားရင်တောင် Memory ပြန်မှတ်ပေးမည်
            return res.json({ success: true, current_token: results[0].token_number });
        }

        // (၂) ပြနေတဲ့သူ မရှိဘူး၊ ဒါပေမယ့် ပြီးသွားတဲ့သူ (completed) တော့ရှိတယ် ဆိုရင် 
        // 💡 (Assistant က Complete နှိပ်ပြီး Call Next မနှိပ်ရသေးတဲ့ ကြားကာလ)
        if (results.length > 0 && results[0].status === 'completed') {
            activeQueues[docCode] = true;
            return res.json({ success: true, current_token: "နောက်လူနာခေါ်နေပါသည်" });
        }

        // (၃) DB ထဲမှာ ဘာမှမရှိသေးဘူး၊ ဒါပေမယ့် Assistant က Start Queue ခလုတ်ကို နှိပ်ထားပြီးပြီဆိုရင်
        if (activeQueues[docCode]) {
            return res.json({ success: true, current_token: "နောက်လူနာခေါ်နေပါသည်" });
        }

        // (၄) ဘာမှလည်း မရှိ၊ Assistant လည်း မစရသေးရင်တော့ မှန်ကန်စွာ Not Started ပြမည်
        return res.json({ success: true, current_token: "Not Started" });
    });
});

// ==========================================
// Patient Status API (Scanner တွင် Booking စစ်ရန်)
// ==========================================
app.get("/api/patient/status/:uid", (req, res) => {
    const today = new Date().toLocaleDateString('en-CA');
    // 🌟 ဤနေရာရှိ IN () ထဲတွင် 'consulting' ကိုပါ ထပ်ပေါင်းထည့်ပေးလိုက်ပါသည်
    const sql = `
        SELECT token_number, status 
        FROM appointments 
        WHERE patient_uid = ? AND appointment_date = ? AND status IN ('waiting', 'arrived', 'consulting', 'completed')
        ORDER BY Appointment_id DESC LIMIT 1
    `;
    db.query(sql, [req.params.uid, today], (err, result) => {
        if (err || result.length === 0) {
            return res.json({ success: false });
        }
        res.json({ success: true, appointment: result[0] });
    });
});
// ==========================================
// Admin Counter အတွက် Patient စာရင်း ဆွဲထုတ်မည့် API
// ==========================================
app.get("/api/admin/patients-data", (req, res) => {
    const sql = `
        SELECT uid, name, phone, address, DATE_FORMAT(created_at, '%Y-%m-%d') as created_date 
        FROM patients 
        ORDER BY created_at DESC
    `;
    
    // 💡 ဤနေရာတွင် 'results' ဟု မှန်ကန်စွာ ကြေညာထားရပါမည်
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Patient Data Fetch Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }

        // Local စံတော်ချိန်ဖြင့် ယနေ့ရက်စွဲ (YYYY-MM-DD) ကို ယူမည်
        const today = new Date().toLocaleDateString('en-CA'); 
        
        // စုစုပေါင်း လူနာအရေအတွက်
        const totalPatients = results.length;
        
        // ယနေ့ စာရင်းသွင်းသော လူနာအရေအတွက်
        const todayPatients = results.filter(p => p.created_date === today).length;

        res.json({ 
            success: true, 
            total: totalPatients, 
            today: todayPatients, 
            patients: results 
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// 💡 (အသစ်) Assistant မှ Start Queue နှိပ်ကြောင်း လက်ခံမည့် API
app.post("/api/assistant/start-queue", (req, res) => {
    const { doctor_code } = req.body;
    activeQueues[doctor_code] = true;
    io.emit("update_queue"); 
    res.json({ success: true });
});
// ==========================================
// Admin မှ လူနာကို Warn/Lock/Unlock လုပ်မည့် API
// ==========================================
app.post("/api/admin/patient-action", (req, res) => {
    const { uid, action } = req.body;

    const updateSql = "UPDATE patients SET status = ? WHERE uid = ?";
    
    db.query(updateSql, [action, uid], (err, result) => {
        if (err) {
            console.error("Patient Action Error:", err);
            return res.json({ success: false, message: "Database Error ဖြစ်နေပါသည်။" });
        }
        
        let msg = action === 'warning' ? "Warning ပေးလိုက်ပါပြီ။" : 
                  action === 'locked' ? "Account ကို Lock ချလိုက်ပါပြီ။" : "Account ကို ပြန်ဖွင့် (Unlock) ပေးလိုက်ပါပြီ။";

        // 🌟 ဤနေရာသည် အသက်ပါပဲ (Socket.io ဖြင့် လူနာဘက်ကို Real-time လှမ်းအကြောင်းကြားမည်)
        io.emit("patient_status_updated", { uid: uid, status: action });

        res.json({ success: true, message: msg });
    });
});

// 🌟 Patient Compliance (လူနာများ၏ စည်းကမ်းလိုက်နာမှု) ကို ဆွဲထုတ်မည့် API
app.get('/api/admin/patients-compliance', (req, res) => {
    const search = req.query.search || '';
    const searchPattern = `%${search}%`;

    // 💡 p.age အစား TIMESTAMPDIFF ဖြင့် အသက်ကို တွက်ထုတ်မည်၊ p.gender ကိုပါ ထည့်ဆွဲမည်
    const query = `
        SELECT 
            p.uid, 
            p.name, 
            TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age, 
            p.gender,
            p.phone,
            p.address,  
            COUNT(v.id) AS violations_count, 
            p.status 
        FROM patients p 
        LEFT JOIN patient_violations v ON p.uid = v.patient_uid 
        WHERE p.uid LIKE ? OR p.name LIKE ?
        GROUP BY p.uid, p.name, p.dob, p.gender, p.phone, p.address, p.status 
        ORDER BY p.uid DESC 
        LIMIT 50
    `;

    db.query(query, [searchPattern, searchPattern], (err, results) => {
        if (err) {
            console.error("Fetch Compliance Error:", err);
            return res.status(500).json({ success: false, message: "Database Error" });
        }
        res.json({ success: true, patients: results });
    });
});
// ==========================================
// Admin - System Rules & Settings API
// ==========================================
// Database ထဲက လက်ရှိ Settings တွေကို ဆွဲထုတ်မည့် API (GET)
app.get("/api/admin/settings", (req, res) => {
    db.query("SELECT setting_key, setting_value FROM system_settings", (err, results) => {
        if (err) return res.json({ success: false, message: "Database Error" });
        res.json({ success: true, settings: results });
    });
});

// Admin Settings Save API အပိုင်း
app.post("/api/admin/settings", (req, res) => {
    // 🌟 max_cancellations ကိုပါ လှမ်းဖမ်းမည်
    const { qr_open, max_violations, max_cancellations } = req.body;

    const queries = [
        { key: 'qr_checkin_open_minutes', val: qr_open },
        { key: 'max_violations_before_lock', val: max_violations },
        // 🌟 အသစ်ထည့်လိုက်သော စည်းကမ်း
        { key: 'max_cancellations_per_day', val: max_cancellations } 
    ];

    let completed = 0;
    let hasError = false;

    queries.forEach(q => {
        db.query("UPDATE system_settings SET setting_value = ? WHERE setting_key = ?", [q.val, q.key], (err) => {
            if (err) hasError = true;
            completed++;
            if (completed === queries.length) {
                if (hasError) return res.json({ success: false, message: "Database Update Error!" });
                res.json({ success: true, message: "စနစ်၏ စည်းကမ်းချက်များကို အောင်မြင်စွာ ပြင်ဆင်လိုက်ပါပြီ!" });
            }
        });
    });
});



// (၂) Admin က ပြင်လိုက်တဲ့ Settings အသစ်တွေကို Save လုပ်မည့် API (POST)
app.post("/api/admin/settings", (req, res) => {
    // 🌟 no_show ကို လက်မခံတော့ပါ
    const { qr_open, max_violations } = req.body;

    const queries = [
        { key: 'qr_checkin_open_minutes', val: qr_open },
        { key: 'max_violations_before_lock', val: max_violations }
    ];

    let completed = 0;
    let hasError = false;

    // Table ထဲက Data (၂) ကြောင်းကို တစ်လှည့်စီ Update လုပ်မည်
    queries.forEach(q => {
        db.query("UPDATE system_settings SET setting_value = ? WHERE setting_key = ?", [q.val, q.key], (err) => {
            if (err) hasError = true;
            completed++;
            if (completed === queries.length) {
                if (hasError) return res.json({ success: false, message: "Database Update Error!" });
                res.json({ success: true, message: "စနစ်၏ စည်းကမ်းချက်များကို အောင်မြင်စွာ ပြင်ဆင်လိုက်ပါပြီ!" });
            }
        });
    });
});

// ==========================================
// Admin - Staff Management API (ဆရာဝန်နာမည်ပါ ဆွဲထုတ်မည်)
// ==========================================
app.get("/api/admin/staff", (req, res) => {
    // 🌟 LEFT JOIN သုံးပြီး ဆရာဝန်နာမည် (doctor_name) ကိုပါ တစ်ခါတည်း ဆွဲထုတ်မည်
    const sql = `
        SELECT s.id, s.username AS name, s.role, s.status, s.phone, d.name AS doctor_name 
        FROM staff s
        LEFT JOIN doctors d ON s.dr_id = d.dr_id
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Fetch Staff Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }
        res.json({ success: true, staff: results });
    });
});

// ==========================================
// Admin - Add New Staff API (V2 Database အတွက်)
// ==========================================
app.post("/api/admin/staff/add", (req, res) => {
    const { name, password, role, status, dr_id } = req.body; 

    // Assistant ဖြစ်မှသာ dr_id ကို ထည့်မည်၊ မဟုတ်ပါက null ထားမည်
    const doctorId = (role === 'Doctor Assistant' && dr_id) ? dr_id : null;

    // 🌟 အားလုံးကို staff ဇယားတစ်ခုတည်းထဲသို့ သွင်းမည်
    const sql = "INSERT INTO staff (username, password, role, status, dr_id) VALUES (?, ?, ?, ?, ?)";
    
    db.query(sql, [name, password, role, status, doctorId], (err) => {
        if (err) {
            console.error("Insert Staff Error:", err);
            return res.json({ success: false, message: "Database Error ကြောင့် သိမ်း၍မရပါ။" });
        }
        res.json({ success: true, message: `${role} အသစ်ကို အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ။` });
    });
});

// ==========================================
// Admin - Edit Staff API (V2 Database အတွက်)
// ==========================================
app.post("/api/admin/staff/edit", (req, res) => {
    const { id, name, role, status, dr_id } = req.body;
    
    const doctorId = (role === 'Doctor Assistant' && dr_id) ? dr_id : null;

    // 🌟 staff ဇယားတစ်ခုတည်းကိုသာ Update လုပ်မည်
    const sql = "UPDATE staff SET username = ?, role = ?, status = ?, dr_id = ? WHERE id = ?";
    
    db.query(sql, [name, role, status, doctorId, id], (err) => {
        if (err) return res.json({ success: false, message: "Update ပြုလုပ်ရာတွင် Database Error ဖြစ်နေပါသည်။" });
        res.json({ success: true, message: `${role} ကို အောင်မြင်စွာ ပြင်ဆင်လိုက်ပါပြီ။` });
    });
});

// ==========================================
// Admin - Staff ကို ဖျက်ပြီး မှတ်တမ်းသိမ်းမည့် API (V2 Database အတွက်)
// ==========================================
app.post("/api/admin/staff/delete", (req, res) => {
    const { id, role } = req.body;

    // 🌟 staff ဇယားထဲမှ တိုက်ရိုက် ရှာမည်
    db.query("SELECT id, username FROM staff WHERE id = ?", [id], (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "ဝန်ထမ်းကို Database တွင် ရှာမတွေ့ပါ။" });
        
        const staff = results[0];
        
        // (၁) မှတ်တမ်း (Archive) ထဲသို့ အရင်သိမ်းမည်
        db.query("INSERT INTO deleted_staff_records (original_id, name, role, phone) VALUES (?, ?, ?, ?)", 
        [staff.id, staff.username, role, 'N/A'], (err2) => {
            if (err2) {
                console.error("Archive Error:", err2);
                return res.json({ success: false, message: "မှတ်တမ်းသိမ်းဆည်းရာတွင် Error ဖြစ်နေပါသည်။" });
            }
            
            // (၂) ပင်မ staff ဇယားထဲမှ အပြီးဖျက်မည်
            db.query("DELETE FROM staff WHERE id = ?", [id], (err3) => {
                if (err3) return res.json({ success: false, message: "ဖျက်ရာတွင် Error ဖြစ်နေပါသည်။" });
                res.json({ success: true, message: `${role} ကို မှတ်တမ်းသိမ်းပြီး အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ!` });
            });
        });
    });
});

// ==========================================
// Admin - Dropdown အတွက် ဆရာဝန်စာရင်း ဆွဲထုတ်မည့် API
// ==========================================
app.get("/api/admin/doctors-list", (req, res) => {
    db.query("SELECT dr_id, name, specialty FROM doctors", (err, results) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, doctors: results });
    });
});
// ==========================================
// Admin Dashboard အတွက် စာရင်းချုပ် (Real Data) API
// ==========================================
app.get("/api/admin/dashboard-stats", (req, res) => {
    // ယနေ့ရက်စွဲကို မြန်မာစံတော်ချိန်ဖြင့် ယူမည်
    const today = new Date().toLocaleDateString('en-CA');

    // 🌟 Staff အားလုံး (Admin + Counter + Assistants) ကို ပေါင်းပြီး ရေတွက်မည်
    const statsSql = `
        SELECT 
            (SELECT COUNT(*) FROM patients) AS total_patients,
            (SELECT COUNT(*) FROM doctors) AS total_doctors,
            (SELECT COUNT(*) FROM staff) AS total_staff,
            (SELECT COUNT(*) FROM appointments WHERE appointment_date = ?) AS today_appointments
    `;

    db.query(statsSql, [today], (err, statsResult) => {
        if (err) {
            console.error("Dashboard Stats Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }

        // 🌟 ဇယားတွင် ပြရန် Warning/Locked ဖြစ်နေသော လူနာများကို ဆွဲထုတ်မည်
        const recentSql = `
            SELECT uid, status 
            FROM patients 
            WHERE status IN ('warning', 'locked') 
            ORDER BY uid DESC LIMIT 5
        `;
        
        db.query(recentSql, (err, recentResult) => {
            if (err) return res.json({ success: false, message: "Database Error" });
            
            res.json({ 
                success: true, 
                stats: statsResult[0],
                recent_violations: recentResult
            });
        });
    });
});

// ==========================================
// Admin - ဆရာဝန်အသစ် ထည့်ရန် API
// ==========================================
app.post("/api/admin/doctors/add", (req, res) => {
    const { doctor_code, name, specialty, experience, available_days, working_time, room_number } = req.body;
    
    // 🌟 room_number မပါလျှင် Error ပြမည် (Default မသုံးတော့ပါ)
    if (!doctor_code || !name || !specialty || !experience || !available_days || !working_time || !room_number) {
        return res.json({ success: false, message: "Please fill all required fields including Room Number." });
    }

    const sql = "INSERT INTO doctors (doctor_code, name, specialty, experience, available_days, working_time, room_number) VALUES (?, ?, ?, ?, ?, ?, ?)";
    
    db.query(sql, [doctor_code, name, specialty, experience, available_days, working_time, room_number], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: "Doctor Code already exists." });
            return res.json({ success: false, message: "Database Error." });
        }
        res.json({ success: true, message: "Doctor added successfully." });
    });
});
// ==========================================
// Assistant - လူနာ၏ Appointment ကို Cancel (ဖျက်) ရန် API
// ==========================================
app.delete("/api/appointment/:id", (req, res) => {
    const appointmentId = req.params.id;
    
    // Database ထဲမှ Appointment_id နှင့် တိုက်စစ်ပြီး ဖျက်မည်
    const sql = "DELETE FROM appointments WHERE Appointment_id = ?"; 
    
    db.query(sql, [appointmentId], (err, result) => {
        if (err) {
            console.error("Error deleting appointment:", err);
            return res.json({ success: false, message: "Database Error ကြောင့် ဖျက်၍မရပါ။" });
        }
        
        // 🌟 ဖျက်ပြီးတာနဲ့ Assistant Dashboard ကို Real-time Update လုပ်ခိုင်းမည်
        io.emit("update_queue");
        
        res.json({ success: true, message: "Booking ကို အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။" });
    });
});


// ==========================================
// လူနာက Booking ပြန်ဖျက်သည့် API (Dynamic Limit ဖြင့်)
// ==========================================
app.post('/api/patient/cancel', (req, res) => {
    // 💡 ဤနေရာတွင် Frontend မှ uid တစ်ခုတည်းသာ ပို့သည်ဟု ယူဆပါမည်
    const { uid } = req.body;

    // ၁။ အရင်ဆုံး ဤလူနာ၏ 'waiting' ဖြစ်နေသော Booking ကို Database ထဲမှ အလိုအလျောက် ရှာမည်
    const findSql = "SELECT Appointment_id FROM appointments WHERE patient_uid = ? AND status = 'waiting' LIMIT 1";
    
    db.query(findSql, [uid], (err, results) => {
        if (err) {
            console.error("Find Appointment Error:", err);
            return res.json({ success: false, message: "Database Error ဖြစ်နေပါသည်။" });
        }

        // တွေ့ရှိခြင်း မရှိပါက (တကယ်ပဲ ဖျက်စရာ မရှိပါက)
        if (results.length === 0) {
            return res.json({ 
                success: false, 
                message: "လက်ရှိတွင် ပယ်ဖျက်ရန် Booking မရှိပါ (သို့) ပယ်ဖျက်ခွင့် မရှိတော့ပါ။" 
            });
        }

        // 💡 တွေ့ပြီဆိုပါက ထို Appointment_id ကို ဆွဲယူမည်
        const appointment_id = results[0].Appointment_id;

        // ၂။ ထို ID ကို အသုံးပြု၍ 'cancelled' အဖြစ် ပြောင်းမည်
        const updateSql = "UPDATE appointments SET status = 'cancelled' WHERE Appointment_id = ?";
        db.query(updateSql, [appointment_id], (err) => {
            if (err) return res.json({ success: false, message: "ဖျက်၍ မရပါ။ Database Error" });

            // ၃။ ယနေ့အတွက် ဤလူနာ Cancel လုပ်သည့် အကြိမ်ရေကို ရေတွက်မည်
            const checkCancelSql = "SELECT COUNT(*) as cancel_count FROM appointments WHERE patient_uid = ? AND status = 'cancelled' AND appointment_date = CURDATE()";
            
            db.query(checkCancelSql, [uid], (err, countRes) => {
                if (err) {
                    io.emit("update_queue");
                    return res.json({ success: true, message: "Booking ကို အောင်မြင်စွာ ပယ်ဖျက်လိုက်ပါပြီ။" });
                }

                // 🌟 ၄။ Admin သတ်မှတ်ထားသော 'max_cancellations_per_day' ကို ဆွဲထုတ်မည်
                db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'max_cancellations_per_day'", (err, setRes) => {
                    let maxCancels = 2; // Default ကို (၂) ကြိမ်ဟု ထားမည် (Admin က မသတ်မှတ်ရသေးလျှင်)
                    if (!err && setRes.length > 0) {
                        maxCancels = parseInt(setRes[0].setting_value);
                    }

                    // 🌟 ၅။ Admin သတ်မှတ်ထားသော အကြိမ်ရေ ပြည့်သွားပါက
                    if (countRes && countRes[0].cancel_count >= maxCancels) {
                        // 🚨 ပြစ်မှုမှတ်တမ်း (violations) ထဲသို့ အလိုအလျောက် သွင်းမည်
                        const vSql = `INSERT INTO patient_violations (patient_uid, appointment_id, violation_type, action_taken) VALUES (?, ?, 'Excessive Cancellations (${maxCancels} Times)', 'Auto Warning')`;
                        
                        db.query(vSql, [uid, appointment_id], () => {
                            // 🚨 လူနာ၏ Status ကို 'warning' သို့ ပြောင်းမည်
                            db.query("UPDATE patients SET status = 'warning' WHERE uid = ? AND status != 'locked'", [uid], () => {
                                io.emit("update_queue");
                                io.emit("patient_status_updated", { uid: uid, status: 'warning' }); 
                                
                                return res.json({ 
                                    success: true, 
                                    message: `Booking ကို ပယ်ဖျက်လိုက်ပါသည်။\n(⚠️ ယနေ့ ${maxCancels} ကြိမ်မြောက် ဖျက်ခြင်းဖြစ်သဖြင့် သင့်အကောင့်အား Warning ပေးလိုက်ပါပြီ)` 
                                });
                            });
                        });
                    } else {
                        // 🌟 အကြိမ်ရေ မပြည့်သေးရင် ရိုးရိုးပဲ Cancel လုပ်ကြောင်း ပြန်ပို့မည်
                        io.emit("update_queue");
                        return res.json({ success: true, message: "Booking ကို အောင်မြင်စွာ ပယ်ဖျက်လိုက်ပါပြီ။" });
                    }
                });
            });
        });
    });
});
//=======================================
// Admin - လူနာအကောင့်ကို အပြီးတိုင် ဖျက်မည့် API
// ==========================================
app.get("/api/patient/status/:uid", (req, res) => {
    const today = new Date().toLocaleDateString('en-CA');
    // 🌟 JOIN သုံးပြီး room_number ကို ယူမည်
    const sql = `
        SELECT a.token_number, a.status, d.room_number 
        FROM appointments a
        JOIN doctors d ON a.doctor_code = d.doctor_code
        WHERE a.patient_uid = ? AND a.appointment_date = ? AND a.status IN ('waiting', 'arrived', 'consulting', 'completed')
        ORDER BY a.Appointment_id DESC LIMIT 1
    `;
    db.query(sql, [req.params.uid, today], (err, result) => {
        if (err || result.length === 0) return res.json({ success: false });
        res.json({ success: true, appointment: result[0] });
    });
});
// =================================================================
// 🌟 1. SYSTEM RULES: Auto No-Show & Auto Lock (၁ မိနစ် တစ်ခါ Auto အလုပ်လုပ်မည်)
// =================================================================
/*setInterval(() => {
    db.query("SELECT setting_key, setting_value FROM settings", (err, settingsDb) => {
        if (err) return;
        
        let noShowLimit = 15; 
        let maxViolations = 2; 

        settingsDb.forEach(s => {
            if(s.setting_key === 'no_show_threshold_minutes') noShowLimit = parseInt(s.setting_value);
            if(s.setting_key === 'max_violations_before_lock') maxViolations = parseInt(s.setting_value);
        });

        // 💡 id အစား Appointment_id ဟု ပြောင်းသုံးထားပါသည်
        const checkLateQuery = `
            SELECT Appointment_id, patient_uid 
            FROM appointments 
            WHERE status = 'waiting' 
            AND appointment_date = CURDATE() 
            AND TIMESTAMPDIFF(MINUTE, CONCAT(appointment_date, ' ', appointment_time), NOW()) >= ?
        `;

        db.query(checkLateQuery, [noShowLimit], (err, latePatients) => {
            if (err || !latePatients || latePatients.length === 0) return;

            latePatients.forEach(patient => {
                // 💡 id အစား Appointment_id ဟု ပြောင်းသုံးထားပါသည်
                db.query("UPDATE appointments SET status = 'no-show' WHERE Appointment_id = ?", [patient.Appointment_id]);

                db.query("INSERT INTO patient_violations (patient_uid, reason) VALUES (?, 'Booking အချိန်ကျော်လွန်၍ No-Show သတ်မှတ်ခံရခြင်း')", [patient.patient_uid], () => {

                    db.query("SELECT COUNT(id) AS v_count FROM patient_violations WHERE patient_uid = ?", [patient.patient_uid], (err, vRes) => {
                        if (vRes && vRes[0] && vRes[0].v_count >= maxViolations) {
                            db.query("UPDATE patients SET status = 'locked' WHERE uid = ?", [patient.patient_uid]);
                            console.log(`🔒 🚨 Auto-Locked Patient: ${patient.patient_uid} (Violations Limit Exceeded)`);
                        }
                    });
                });
            });
        });
    });
}, 60000); // 60000 ms = 1 Minute*/

// 🌟 လူနာတစ်ဦးတွင် လက်ရှိ 'waiting' ဖြစ်နေသော Booking ရှိမရှိ စစ်ဆေးမည့် API
app.get('/api/patient/active-booking/:uid', (req, res) => {
    const uid = req.params.uid;

    // 💡 ပြင်ဆင်ချက်: အတိတ်က (မနေ့က) ရက်များကို လျစ်လျူရှုရန် CURDATE() ထည့်သွင်းထားသည်
    const sql = `
        SELECT a.*, d.name AS doctor_name 
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_code = d.doctor_code
        WHERE a.patient_uid = ? AND a.status = 'waiting' AND a.appointment_date >= CURDATE()
        LIMIT 1
    `;

    db.query(sql, [uid], (err, results) => {
        if (err) {
            console.error("Active Booking Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }

        if (results.length > 0) {
            res.json({ success: true, hasBooking: true, booking: results[0] });
        } else {
            res.json({ success: true, hasBooking: false });
        }
    });
});
// ==========================================
// Admin - ရှိပြီးသား ဆရာဝန် အချက်အလက်များ ပြင်ဆင်ရန် API (Edit Doctor)
// ==========================================
app.post("/api/admin/doctors/edit", (req, res) => {
    const { doctor_code, name, specialty, experience, available_days, working_time, status, room_number } = req.body;

    if (!doctor_code) return res.json({ success: false, message: "Doctor Code is required." });

    const sql = `
        UPDATE doctors 
        SET name = ?, specialty = ?, experience = ?, available_days = ?, working_time = ?, status = ?, room_number = ?
        WHERE doctor_code = ?
    `;
    
    db.query(sql, [name, specialty, experience, available_days, working_time, status || 'active', room_number, doctor_code], (err, result) => {
        if (err) return res.json({ success: false, message: "Database Error." });
        res.json({ success: true, message: "Doctor updated successfully." });
    });
});
// ==========================================
// Admin - ဆရာဝန်စာရင်း အားလုံးကို ဆွဲထုတ်မည့် API
// ==========================================
app.get("/api/admin/doctors", (req, res) => {
    db.query("SELECT * FROM doctors", (err, results) => {
        if (err) {
            console.error("Admin Doctors Fetch Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }
        res.json({ success: true, doctors: results });
    });
});
// ==========================================
// 🌟 လူနာအကောင့် ရှိ/မရှိ စစ်ဆေးမည့် API (Ghost Session ကာကွယ်ရန်)
// ==========================================
app.get("/api/verify-patient/:uid", (req, res) => {
    db.query("SELECT uid FROM patients WHERE uid = ?", [req.params.uid], (err, result) => {
        if (err || result.length === 0) {
            // Database ထဲမှာ မရှိတော့ပါက (အဖျက်ခံလိုက်ရပါက)
            return res.json({ exists: false });
        }
        // အကောင့် ရှိနေသေးပါက
        res.json({ exists: true });
    });
});
// ==========================================
// Admin - လူနာအကောင့်အား အပြီးတိုင် ဖျက်သိမ်းရန်
// ==========================================
app.delete("/api/admin/patient/:uid", (req, res) => {
    const uid = req.params.uid;

    // 🌟 အဆင့် (၁) - ထိုလူနာ၏ Booking မှတ်တမ်းများ (Relation) ကို အရင်ဖျက်မည်
    db.query("DELETE FROM appointments WHERE patient_uid = ?", [uid], (err, result1) => {
        if (err) {
            console.error("Error deleting patient appointments:", err);
            return res.json({ success: false, message: "Database Error ကြောင့် လူနာ၏ Booking များကို ဖျက်၍မရပါ။" });
        }

        // 🌟 အဆင့် (၂) - Booking ရှင်းသွားမှ လူနာအကောင့် (Patient) ကို အပြီးဖျက်မည်
        db.query("DELETE FROM patients WHERE uid = ?", [uid], (err, result2) => {
            if (err) {
                console.error("Error deleting patient:", err);
                return res.json({ success: false, message: "Database Error ကြောင့် လူနာအကောင့်ကို ဖျက်၍မရပါ။" });
            }
            io.emit("update_patient_list");
            res.json({ success: true, message: "လူနာအကောင့်ကို အပြီးတိုင် ဖျက်သိမ်းလိုက်ပါပြီ။ ✅" });
        });
    });
});
// ==========================================
// Assistant - Manual No-Show ခလုတ်အတွက် API 
// ==========================================
app.post("/api/assistant/no-show", (req, res) => {
    const { appointment_id, patient_uid } = req.body;

    // (၁) Appointment ကို 'no-show' အဖြစ် ပြောင်းမည်
    db.query("UPDATE appointments SET status = 'no-show' WHERE Appointment_id = ?", [appointment_id], (err) => {
        if (err) return res.json({ success: false, message: "Database Error ကြောင့် No-Show လုပ်၍မရပါ။" });

        // (၂) ပြစ်မှုမှတ်တမ်း (patient_violations) ထဲသို့ ထည့်မည်
        db.query("INSERT INTO patient_violations (patient_uid, appointment_id, violation_type, action_taken) VALUES (?, ?, 'No-Show', 'Warning/Lock Checked')", [patient_uid, appointment_id], (err) => {
            
            // (၃) System Settings ထဲက Lock ချမည့် အကြိမ်အရေအတွက်ကို ဆွဲထုတ်မည်
            db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'max_violations_before_lock'", (err, setRes) => {
                let maxViolations = 2; // Default
                if (setRes && setRes.length > 0) maxViolations = parseInt(setRes[0].setting_value);

                // (၄) လူနာရဲ့ စုစုပေါင်း ပြစ်မှုအကြိမ်အရေအတွက်ကို ရေတွက်မည်
                db.query("SELECT COUNT(id) AS v_count FROM patient_violations WHERE patient_uid = ?", [patient_uid], (err, countRes) => {
                    const currentViolations = countRes[0].v_count;
                    
                    if (currentViolations >= maxViolations) {
                        // 🚨 Max ပြည့်သွားရင် Lock ချမည်
                        db.query("UPDATE patients SET status = 'locked' WHERE uid = ?", [patient_uid], () => {
                            io.emit("update_queue");
                            io.emit("patient_status_updated", { uid: patient_uid, status: 'locked' }); // လူနာဆီ Alert တန်းပို့မည်
                            return res.json({ success: true, message: "No-Show သတ်မှတ်လိုက်ပါသည်။\n(ခွင့်ပြုထားသော အကြိမ်ရေ ပြည့်သွားသဖြင့် ဤလူနာအား Lock ချလိုက်ပါပြီ)" });
                        });
                    } else {
                        // ⚠️ မပြည့်သေးရင် Warning ပြောင်းမည်
                        db.query("UPDATE patients SET status = 'warning' WHERE uid = ? AND status != 'locked'", [patient_uid], () => {
                            io.emit("update_queue");
                            io.emit("patient_status_updated", { uid: patient_uid, status: 'warning' });
                            return res.json({ success: true, message: "No-Show သတ်မှတ်လိုက်ပါသည်။\n(ဤလူနာအား Warning ပေးလိုက်ပါပြီ)" });
                        });
                    }
                });
            });
        });
    });
});
// ==========================================
// Admin - Staff Password ကို Reset ချပေးမည့် API
// ==========================================
app.post("/api/admin/staff/reset-password", (req, res) => {
    const { id, newPassword } = req.body;
    
    if (!id || !newPassword) {
        return res.json({ success: false, message: "Password အသစ် ရိုက်ထည့်ရန် လိုအပ်ပါသည်။" });
    }

    const sql = "UPDATE staff SET password = ? WHERE id = ?";
    db.query(sql, [newPassword, id], (err) => {
        if (err) {
            console.error("Reset Password Error:", err);
            return res.json({ success: false, message: "Database Error ကြောင့် ပြင်ဆင်၍မရပါ။" });
        }
        res.json({ success: true, message: "🔑 Password ကို အောင်မြင်စွာ ပြောင်းလဲပေးလိုက်ပါပြီ!" });
    });
});