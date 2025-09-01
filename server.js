const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');
const { createClient } = require('@vercel/kv');

// Inisialisasi Klien Vercel KV dengan kredensial dari environment variables
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Discord OAuth2 Scopes
const scopes = ['identify'];

// Konfigurasi Passport
passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI,
    scope: scopes
}, function(accessToken, refreshToken, profile, done) {
    process.nextTick(function() {
        return done(null, profile);
    });
}));

// Middleware
app.use(session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Sesi berlaku selama 24 jam
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// Melayani file statis dari direktori 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rute untuk mendapatkan leaderboard dari Vercel KV
app.get('/api/leaderboard', async (req, res) => {
    try {
        let leaderboardData = await kv.get('leaderboard') || [];
        
        // Memastikan data yang diambil dari KV adalah array yang valid
        if (!Array.isArray(leaderboardData)) {
            // Hapus kunci yang rusak dan gunakan array kosong
            await kv.del('leaderboard');
            leaderboardData = [];
            console.warn('Leaderboard data in KV was not an array. Resetting and deleting the key.');
        }

        // Urutkan berdasarkan skor tertinggi dan ambil 10 teratas
        const sortedLeaderboard = leaderboardData
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
            
        res.json(sortedLeaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard from KV:', error);
        res.status(500).send('Error fetching leaderboard');
    }
});

// Rute untuk mengirimkan skor ke Vercel KV
app.post('/api/leaderboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const { userId, username, score } = req.body;

    try {
        let currentLeaderboard = await kv.get('leaderboard') || [];
        
        // Memastikan data yang diambil adalah array yang valid
        if (!Array.isArray(currentLeaderboard)) {
            // Hapus kunci yang rusak dan gunakan array kosong
            await kv.del('leaderboard');
            currentLeaderboard = [];
            console.warn('Leaderboard data in KV was not an array. Resetting and deleting the key.');
        }

        // Cari entri yang sudah ada untuk user ini
        const existingEntryIndex = currentLeaderboard.findIndex(entry => entry.userId === userId);

        if (existingEntryIndex !== -1) {
            // Jika user sudah ada, update skor hanya jika lebih tinggi
            if (score > currentLeaderboard[existingEntryIndex].score) {
                currentLeaderboard[existingEntryIndex].score = score;
                currentLeaderboard[existingEntryIndex].username = username; // Update username jika berubah
            }
        } else {
            // Jika user baru, tambahkan ke leaderboard
            currentLeaderboard.push({ userId, username, score });
        }
        
        // Simpan kembali ke KV
        await kv.set('leaderboard', currentLeaderboard);
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Failed to save score to KV:', error);
        res.status(500).send('Error saving score');
    }
});

// Rute login dan autentikasi
app.get('/login', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/?authenticated=true');
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Melayani halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Menjalankan server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
