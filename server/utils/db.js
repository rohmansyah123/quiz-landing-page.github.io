const { Pool } = require('pg');

const pool = new Pool({
    user: 'your_user',
    host: 'localhost',
    database: 'quiz_db',
    password: 'your_password',
    port: 5432,
});

async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS numbers (
                number INT PRIMARY KEY,
                owner_whatsapp VARCHAR(20) NULL,
                selected BOOLEAN DEFAULT FALSE
            );
        `);
        // Inisialisasi 1000 nomor jika belum ada
        const { rowCount } = await pool.query('SELECT COUNT(*) FROM numbers');
        if (rowCount === 0) {
            let insertQuery = 'INSERT INTO numbers (number) VALUES ';
            const values = [];
            for (let i = 1; i <= 1000; i++) {
                values.push(`(${i})`);
            }
            insertQuery += values.join(',');
            await pool.query(insertQuery);
            console.log('1000 numbers initialized in DB.');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS winners (
                id SERIAL PRIMARY KEY,
                rank INT,
                winner_number INT,
                winner_whatsapp VARCHAR(20),
                announced_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('Database tables created/checked.');
    } catch (err) {
        console.error('Error setting up database:', err);
        throw err;
    }
}

async function getQuizState(quizEndTime, isSelectionActive, winnersAnnounced) {
    const numbersResult = await pool.query('SELECT number, owner_whatsapp, selected FROM numbers');
    const numbersMap = {};
    numbersResult.rows.forEach(row => {
        numbersMap[row.number] = {
            selected: row.selected,
            // Mask WhatsApp on server-side before sending
            owner: row.selected ? (row.owner_whatsapp.substring(0, row.owner_whatsapp.length - 4) + 'XXXX') : null
        };
    });

    let winners = [];
    if (winnersAnnounced) {
        const winnersResult = await pool.query('SELECT winner_number, winner_whatsapp FROM winners ORDER BY rank ASC LIMIT 3');
        winners = winnersResult.rows.map(row => ({
            number: row.winner_number,
            whatsapp: row.winner_whatsapp.substring(0, row.winner_whatsapp.length - 4) + 'XXXX'
        }));
    }

    return {
        numbers: numbersMap,
        countdownEndTime: quizEndTime,
        isSelectionActive: isSelectionActive,
        winners: winners,
    };
}

async function updateNumberStatus(number, whatsapp) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT selected FROM numbers WHERE number = $1 FOR UPDATE', [number]);
        if (check.rows.length === 0 || check.rows[0].selected) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Nomor sudah dipilih atau tidak valid.' };
        }

        await client.query(
            'UPDATE numbers SET selected = TRUE, owner_whatsapp = $1 WHERE number = $2',
            [whatsapp, number]
        );
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating number status:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function getNumberOwner(number) {
    const result = await pool.query('SELECT owner_whatsapp FROM numbers WHERE number = $1', [number]);
    return result.rows.length > 0 ? { whatsapp: result.rows[0].owner_whatsapp } : null;
}

async function saveWinners(winners) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Bersihkan pemenang sebelumnya jika ada, atau tambahkan logika versi kuis
        await client.query('DELETE FROM winners'); // Untuk menyederhanakan, kita hapus dulu
        for (let i = 0; i < winners.length; i++) {
            await client.query(
                'INSERT INTO winners (rank, winner_number, winner_whatsapp) VALUES ($1, $2, $3)',
                [i + 1, winners[i].number, winners[i].whatsapp]
            );
        }
        await client.query('COMMIT');
        console.log('Winners saved to DB.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving winners:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function resetDatabase() {
    try {
        // Reset status semua nomor menjadi tidak terpilih dan kosongkan pemilik
        await pool.query('UPDATE numbers SET selected = FALSE, owner_whatsapp = NULL');
        // Hapus data pemenang
        await pool.query('DELETE FROM winners');
        console.log('Database reset successfully.');
        return { success: true };
    } catch (error) {
        console.error('Error resetting database:', error);
        throw error;
    }
}

module.exports = {
    setupDatabase,
    getQuizState,
    updateNumberStatus,
    getNumberOwner,
    saveWinners,
    resetDatabase,
};
          
