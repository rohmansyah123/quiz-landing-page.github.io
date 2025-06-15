// Inisialisasi Socket.IO
const socket = io();

// Variabel global untuk status kuis
let quizState = {
    numbers: {}, // { '1': { owner: '0812-XXXX-XXXX', selected: true }, '2': { ... } }
    countdownEndTime: null,
    winners: [],
    isSelectionActive: false,
};

const COUNTDOWN_ELEMENT = document.getElementById('countdown');
const NUMBERS_GRID = document.querySelector('.numbers-grid');
const SELECTION_FORM = document.getElementById('selection-form');
const SELECTED_NUMBER_INPUT = document.getElementById('selected-number-input');
const WHATSAPP_INPUT = document.getElementById('whatsapp-input');
const SUBMIT_BUTTON = document.getElementById('submit-selection');
const ERROR_MESSAGE = document.getElementById('error-message');
const LEADERBOARD_SECTION = document.getElementById('leaderboard');
const WINNER_TABLE_BODY = document.querySelector('#winner-table tbody');

let selectedNumber = null;

// --- Fungsi Rendering ---
function renderNumbers() {
    NUMBERS_GRID.innerHTML = ''; // Bersihkan grid sebelum render ulang
    for (let i = 1; i <= 1000; i++) {
        const numberItem = document.createElement('div');
        numberItem.classList.add('number-item');
        numberItem.textContent = i;
        numberItem.dataset.number = i;

        if (quizState.numbers[i] && quizState.numbers[i].selected) {
            numberItem.classList.add('selected');
            // Menandai nomor yang sudah dipilih sebagai tidak aktif
            numberItem.classList.add('disabled');
        } else if (!quizState.isSelectionActive) {
            numberItem.classList.add('disabled'); // Nonaktifkan jika masa pemilihan sudah habis
        } else {
            // Tambahkan event listener hanya jika bisa dipilih
            numberItem.addEventListener('click', () => handleNumberClick(i, numberItem));
        }
        NUMBERS_GRID.appendChild(numberItem);
    }
}

function handleNumberClick(number, element) {
    if (!quizState.isSelectionActive) {
        ERROR_MESSAGE.textContent = 'Masa pemilihan nomor sudah berakhir.';
        return;
    }
    if (quizState.numbers[number] && quizState.numbers[number].selected) {
        ERROR_MESSAGE.textContent = 'Nomor ini sudah dipilih, silakan pilih nomor lain.';
        return;
    }

    // Reset pilihan sebelumnya
    if (selectedNumber !== null) {
        const prevSelectedElement = document.querySelector(`.number-item[data-number="${selectedNumber}"]`);
        if (prevSelectedElement) {
            prevSelectedElement.classList.remove('active-selection'); // Kelas visual untuk pilihan sementara
        }
    }

    selectedNumber = number;
    SELECTED_NUMBER_INPUT.value = number;
    SELECTION_FORM.style.display = 'block'; // Tampilkan form
    element.classList.add('active-selection'); // Tandai pilihan sementara
    ERROR_MESSAGE.textContent = ''; // Hapus pesan error
}

function updateCountdown() {
    if (!quizState.countdownEndTime) {
        COUNTDOWN_ELEMENT.textContent = 'Kuis belum dimulai atau data waktu belum tersedia.';
        return;
    }

    const now = new Date().getTime();
    const distance = quizState.countdownEndTime - now;

    if (distance < 0) {
        COUNTDOWN_ELEMENT.textContent = 'Waktu Habis!';
        quizState.isSelectionActive = false; // Pastikan status berubah
        // Panggil renderNumbers untuk menonaktifkan semua nomor jika belum otomatis
        renderNumbers();
        // Mungkin tampilkan pesan bahwa pengundian sedang berlangsung
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    COUNTDOWN_ELEMENT.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function renderWinners() {
    if (quizState.winners.length > 0) {
        LEADERBOARD_SECTION.style.display = 'block';
        WINNER_TABLE_BODY.innerHTML = '';
        quizState.winners.forEach((winner, index) => {
            const row = WINNER_TABLE_BODY.insertRow();
            row.insertCell(0).textContent = index + 1;
            row.insertCell(1).textContent = winner.number;
            // Sensor nomor WhatsApp
            const maskedWhatsapp = winner.whatsapp.substring(0, winner.whatsapp.length - 4) + 'XXXX';
            row.insertCell(2).textContent = maskedWhatsapp;
        });
    } else {
        LEADERBOARD_SECTION.style.display = 'none';
    }
}

// --- Event Listeners ---
SUBMIT_BUTTON.addEventListener('click', async () => {
    const whatsapp = WHATSAPP_INPUT.value.trim();

    if (!selectedNumber || !whatsapp) {
        ERROR_MESSAGE.textContent = 'Harap pilih nomor dan masukkan nomor WhatsApp Anda.';
        return;
    }

    // Validasi format WhatsApp (sederhana)
    if (!/^\d{10,15}$/.test(whatsapp)) { // Contoh: 10-15 digit angka
        ERROR_MESSAGE.textContent = 'Format nomor WhatsApp tidak valid (contoh: 081234567890).';
        return;
    }

    try {
        const response = await fetch('/api/select-number', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: selectedNumber, whatsapp }),
        });

        const result = await response.json();

        if (response.ok) {
            alert('Nomor Anda berhasil dikunci!');
            SELECTION_FORM.style.display = 'none';
            selectedNumber = null;
            WHATSAPP_INPUT.value = '';
            ERROR_MESSAGE.textContent = '';
            // Data akan diupdate melalui WebSocket, jadi tidak perlu render ulang penuh di sini.
        } else {
            ERROR_MESSAGE.textContent = result.message || 'Terjadi kesalahan saat mengunci nomor.';
        }
    } catch (error) {
        console.error('Error selecting number:', error);
        ERROR_MESSAGE.textContent = 'Gagal terhubung ke server. Coba lagi.';
    }
});

// --- WebSocket Event Handlers ---
socket.on('initialData', (data) => {
    quizState.numbers = data.numbers;
    quizState.countdownEndTime = data.countdownEndTime ? new Date(data.countdownEndTime).getTime() : null;
    quizState.winners = data.winners || [];
    quizState.isSelectionActive = data.isSelectionActive; // Status dari server

    renderNumbers();
    renderWinners();
    if (quizState.countdownEndTime) {
        setInterval(updateCountdown, 1000); // Mulai countdown
    }
    updateCountdown(); // Panggil sekali untuk inisialisasi
});

socket.on('numberSelected', (data) => {
    quizState.numbers[data.number] = { selected: true, owner: data.maskedWhatsapp };
    const numberElement = document.querySelector(`.number-item[data-number="${data.number}"]`);
    if (numberElement) {
        numberElement.classList.add('selected', 'disabled');
        numberElement.removeEventListener('click', () => handleNumberClick(data.number, numberElement));
    }
    // Opsional: tampilkan notifikasi di UI
});

socket.on('quizEnded', (data) => {
    quizState.isSelectionActive = false;
    renderNumbers(); // Nonaktifkan semua nomor
    COUNTDOWN_ELEMENT.textContent = 'Waktu Habis! Pengundian sedang berlangsung...';
    // Sembunyikan form pemilihan
    SELECTION_FORM.style.display = 'none';
});

socket.on('winnersAnnounced', (data) => {
    quizState.winners = data.winners;
    renderWinners();
    // Mungkin tampilkan pop-up atau notifikasi besar
    alert('SELAMAT! Pemenang sudah diumumkan!');
    console.log('Pemenang:', data.winners);
});

socket.on('databaseReset', () => {
    alert('Database kuis telah direset. Kuis baru akan segera dimulai!');
    // Muat ulang halaman atau reset state secara menyeluruh
    location.reload();
});

// Lazy load (opsional, untuk elemen besar jika ada)
// Intersection Observer API bisa digunakan di sini untuk gambar/elemen kompleks
// Untuk 1000 div kecil, CSS grid dengan overflow-y sudah cukup efektif.

