
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors'); // Untuk development, di production sesuaikan domain
const { setupDatabase, getQuizState, updateNumberStatus, saveWinners, resetDatabase } = require('./utils/db');
const { startQuizScheduler } = require('./utils/scheduler');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
    cors: {
        origin: "*", // Ganti dengan domain frontend Anda di production
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); // Serve frontend static files

// Global state for quiz (will be synced with DB)
let quizSettings = {
    quizEndTime: null, // Timestamp kapan pemilihan nomor berakhir
    resetTime: null, // Timestamp kapan database akan direset
    isSelectionActive: false,
    winnersAnnounced: false,
};

// --- Routes API ---
app.post('/api/select-number', async (req, res) => {
    const { number, whatsapp } = req.body;

    if (!quizSettings.isSelectionActive) {
        return res.status(400).json({ message: 'Masa pemilihan nomor sudah berakhir.' });
    }

    if (!number || !whatsapp || number < 1 || number > 1000) {
        return res.status(400).json({ message: 'Nomor atau WhatsApp tidak valid.' });
    }

    try {
        const result = await updateNumberStatus(number, whatsapp);
        if (result.success) {
            // Mask WhatsApp for public display
            const maskedWhatsapp = whatsapp.substring(0, whatsapp.length - 4) + 'XXXX';
            // Emit event ke semua client via WebSocket
            io.emit('numberSelected', { number: number, maskedWhatsapp: maskedWhatsapp });
            res.status(200).json({ message: 'Nomor berhasil dikunci!' });
        } else {
            res.status(409).json({ message: result.message }); // 409 Conflict
        }
    } catch (error) {
        console.error('Error selecting number:', error);
        res.status(500).json({ message: 'Terjadi kesalahan server.' });
    }
});

// Endpoint untuk admin setting waktu kuis (sederhana)
app.post('/api/admin/set-quiz-time', async (req, res) => {
    const { durationHours } = req.body; // Durasi dalam jam
    if (!durationHours || isNaN(durationHours) || durationHours <= 0) {
        return res.status(400).json({ message: 'Durasi tidak valid.' });
    }

    const endTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    quizSettings.quizEndTime = endTime.getTime();
    quizSettings.isSelectionActive = true;
    quizSettings.winnersAnnounced = false; // Reset status pemenang
    quizSettings.resetTime = null; // Reset reset time

    // Simpan ke DB agar persisten
    // await saveQuizSettingsToDB({ quizEndTime: quizSettings.quizEndTime, isSelectionActive: true });

    // Emit initial state ke semua client
    io.emit('initialData', await getQuizState(quizSettings.quizEndTime, quizSettings.isSelectionActive, quizSettings.winnersAnnounced));
    res.status(200).json({ message: `Kuis dimulai, berakhir pada ${endTime.toLocaleString()}` });

    // Mulai scheduler untuk kuis ini
    startQuizScheduler(quizSettings.quizEndTime, io, onQuizEnd, onResetTrigger);
});

// --- WebSocket Connection ---
io.on('connection', async (socket) => {
    console.log('A user connected:', socket.id);

    // Kirim data awal ke client yang baru terhubung
    const currentQuizState = await getQuizState(quizSettings.quizEndTime, quizSettings.isSelectionActive, quizSettings.winnersAnnounced);
    socket.emit('initialData', currentQuizState);

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- Fungsi Callback Scheduler ---
async function onQuizEnd(ioInstance) {
    console.log('Quiz time ended. Starting drawing...');
    quizSettings.isSelectionActive = false; // Pastikan tidak ada lagi pemilihan
    quizSettings.winnersAnnounced = true; // Status pemenang akan segera diumumkan

    // 1. Ambil semua nomor yang telah dipilih (opsional, jika ingin pengundian dari yang dipilih saja)
    // const selectedNumbers = await getSelectedNumbers();
    // 2. Lakukan Pengundian dari 1-1000
    const allNumbers = Array.from({ length: 1000 }, (_, i) => i + 1);
    const shuffled = allNumbers.sort(() => 0.5 - Math.random());
    const winningNumbers = shuffled.slice(0, 3);

    const winnersData = [];
    for (const num of winningNumbers) {
        const ownerInfo = await getNumberOwner(num); // Ambil info pemilik dari DB
        winnersData.push({
            number: num,
            whatsapp: ownerInfo ? ownerInfo.whatsapp : 'N/A' // Jika tidak ada pemilik, tandai N/A
        });
    }

    // Simpan pemenang ke database
    await saveWinners(winnersData);

    // Update state
    quizSettings.winners = winnersData; // Update global state
    quizSettings.resetTime = new Date(Date.now() + 60 * 60 * 1000).getTime(); // Set reset time 1 jam dari sekarang

    // Emit event pemenang ke semua client
    ioInstance.emit('winnersAnnounced', { winners: winnersData });
    ioInstance.emit('quizEnded', { message: 'Masa pemilihan sudah berakhir, pemenang telah diumumkan!' });

    // Set scheduler untuk reset database 1 jam kemudian
    startQuizScheduler(quizSettings.resetTime, ioInstance, null, onResetTrigger); // Hanya trigger onResetTrigger
}

async function onResetTrigger(ioInstance) {
    console.log('Resetting database...');
    await resetDatabase();
    quizSettings.quizEndTime = null;
    quizSettings.resetTime = null;
    quizSettings.isSelectionActive = false;
    quizSettings.winnersAnnounced = false;
    quizSettings.winners = []; // Kosongkan pemenang di state

    // Emit event database reset ke semua client
    ioInstance.emit('databaseReset', { message: 'Database telah direset. Kuis baru dapat dimulai!' });
    // Setelah reset, kirim ulang initial data kosong
    ioInstance.emit('initialData', await getQuizState(quizSettings.quizEndTime, quizSettings.isSelectionActive, quizSettings.winnersAnnounced));
}


// Inisialisasi Database dan Scheduler saat server mulai
setupDatabase().then(() => {
    // Muat pengaturan kuis terakhir dari DB saat server start
    // const lastSettings = await loadQuizSettingsFromDB();
    // if (lastSettings) {
    //     quizSettings = { ...quizSettings, ...lastSettings };
    //     if (quizSettings.isSelectionActive && quizSettings.quizEndTime && quizSettings.quizEndTime > Date.now()) {
    //         startQuizScheduler(quizSettings.quizEndTime, io, onQuizEnd, onResetTrigger);
    //     }
    //     if (quizSettings.winnersAnnounced && quizSettings.resetTime && quizSettings.resetTime > Date.now()) {
    //         startQuizScheduler(quizSettings.resetTime, io, null, onResetTrigger);
    //     }
    // }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to database or initialize:', err);
    process.exit(1);
});

