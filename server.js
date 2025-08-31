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
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// Melayani file statis dari direktori 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rute untuk mendapatkan leaderboard dari Vercel KV (menggunakan Sorted Set)
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Ambil 10 skor teratas dari Redis Sorted Set
        const leaderboardData = await kv.zrevrange('leaderboard', 0, 9, 'WITHSCORES');
        
        // Memformat data menjadi array objek yang lebih mudah dibaca
        const formattedLeaderboard = [];
        for (let i = 0; i < leaderboardData.length; i += 2) {
            const username = leaderboardData[i];
            const score = parseInt(leaderboardData[i + 1], 10);
            formattedLeaderboard.push({ username, score });
        }
        
        res.json(formattedLeaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard from KV:', error);
        res.status(500).send('Error fetching leaderboard');
    }
});

// Rute untuk mengirimkan skor ke Vercel KV (menggunakan Sorted Set)
app.post('/api/leaderboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const { username, score } = req.body;

    try {
        // Gunakan ZADD untuk menambahkan/memperbarui skor.
        // Redis akan otomatis menangani pembaruan jika pengguna sudah ada.
        await kv.zadd('leaderboard', { score, member: username });
        
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
    res.redirect('/');
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
