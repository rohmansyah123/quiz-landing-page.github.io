// Sangat sederhana, untuk production gunakan library seperti 'node-cron'
let quizTimeoutId = null;
let resetTimeoutId = null;

function startQuizScheduler(endTime, ioInstance, onQuizEndCallback, onResetTriggerCallback) {
    // Clear existing timers to prevent duplicates if called multiple times
    if (quizTimeoutId) clearTimeout(quizTimeoutId);
    if (resetTimeoutId) clearTimeout(resetTimeoutId);

    const now = Date.now();

    // Schedule quiz end
    if (endTime > now) {
        quizTimeoutId = setTimeout(async () => {
            if (onQuizEndCallback) {
                await onQuizEndCallback(ioInstance);
            }
        }, endTime - now);
        console.log(`Quiz end scheduled for: ${new Date(endTime).toLocaleString()}`);
    } else if (onQuizEndCallback) {
        // Jika waktu sudah lewat, langsung jalankan callback (ini bisa terjadi saat server restart)
        // Pastikan ini tidak memicu berulang kali jika sudah diundi
        console.log('Quiz end time already passed, triggering quiz end callback.');
        onQuizEndCallback(ioInstance);
    }

    // Logic untuk reset database akan diset setelah onQuizEndCallback di server/index.js
    // atau jika server restart dan resetTime sudah diset dari DB.
    // Jika resetTime sudah diset dan belum lewat, jadwalkan.
    // Ini harus ditangani di logika `index.js` saat inisialisasi `quizSettings`.
}

// Fungsi terpisah untuk menjadwalkan reset, dipanggil setelah pemenang diumumkan
function scheduleReset(resetTime, ioInstance, onResetTriggerCallback) {
    if (resetTimeoutId) clearTimeout(resetTimeoutId);

    const now = Date.now();
    if (resetTime > now) {
        resetTimeoutId = setTimeout(async () => {
            if (onResetTriggerCallback) {
                await onResetTriggerCallback(ioInstance);
            }
        }, resetTime - now);
        console.log(`Database reset scheduled for: ${new Date(resetTime).toLocaleString()}`);
    } else if (onResetTriggerCallback) {
        console.log('Reset time already passed, triggering reset callback.');
        onResetTriggerCallback(ioInstance);
    }
}


module.exports = { startQuizScheduler, scheduleReset };

