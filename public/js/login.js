async function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const response = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });

    const result = await response.json();
    console.log("Backend မှ ပြန်လာသော Data:", result);

    // 🌟 (၁) အကယ်၍ Login အောင်မြင်ပါက
    if (result.success) {
        localStorage.setItem("loggedInUID", username);
        const userRole = result.role ? result.role.toLowerCase().trim() : "";

        // 🌟 အရေးကြီး: Page မကူးခင် LocalStorage ထဲ Data အရင် သိမ်းပါမည်
        if (result.doctorName) {
            localStorage.setItem("doctorName", result.doctorName);
        }
        if (result.doctorCode) { 
            localStorage.setItem("doctorCode", result.doctorCode);
        }
        if (result.patientStatus) {
            localStorage.setItem("patientStatus", result.patientStatus);
        }

        // 🌟 Data အကုန်သိမ်းပြီးမှသာ Role ပေါ်မူတည်ပြီး Page ကူးပါမည်
        if (userRole === 'doctor assistant') {
            window.location.href = "doctor_assitant.html";
        } 
        else if (userRole === "patient") {
            window.location.href = "patient.html"; 
        } 
        else if (userRole === "counter" ) {
            window.location.href = "admincounter.html"; 
        } 
        else if (userRole === "admin" ) {
            window.location.href = "main_admin.html"; 
        }
    } 
    // 🚨 (၂) ဤနေရာသည် Login မအောင်မြင်ပါက အလုပ်လုပ်မည့်နေရာဖြစ်သည်
    else {
        // Locked ဖြစ်နေရင် Page ကူးမယ်၊ မဟုတ်ရင် Alert ပြမယ်
        if (result.isLocked) {
            window.location.href = "locked_account.html"; 
        } else {
            alert(result.message); 
        }
    }
}