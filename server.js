const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const { createClient } = require('@vercel/kv'); // Vercel KV

// Inisialisasi Vercel KV Client
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Discord OAuth2 Scopes
const scopes = ['identify'];

// Passport setup
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ====================== LEADERBOARD ======================

// GET leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        let leaderboardData = await kv.get('leaderboard');

        // Pastikan hasil parse JSON
        if (!leaderboardData) {
            leaderboardData = [];
        } else if (typeof leaderboardData === 'string') {
            leaderboardData = JSON.parse(leaderboardData);
        }

        if (!Array.isArray(leaderboardData)) {
            leaderboardData = [];
            await kv.del('leaderboard');
            console.warn('Leaderboard data corrupted, resetting.');
        }

        // Urutkan dari skor tertinggi → terendah
        let sortedLeaderboard = leaderboardData.sort((a, b) => b.score - a.score);

        // Jika frontend butuh limit (misal ?limit=10)
        const limit = parseInt(req.query.limit) || sortedLeaderboard.length;
        sortedLeaderboard = sortedLeaderboard.slice(0, limit);

        res.json(sortedLeaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard from KV:', error);
        res.status(500).send('Error fetching leaderboard');
    }
});

// POST leaderboard
app.post('/api/leaderboard', async (req, res) => {
    // Jika ingin terbuka untuk semua user → hapus check ini
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const { userId, username, score } = req.body;

    if (!userId || !username || typeof score !== 'number') {
        return res.status(400).send('Invalid data');
    }

    try {
        let currentLeaderboard = await kv.get('leaderboard');

        if (!currentLeaderboard) {
            currentLeaderboard = [];
        } else if (typeof currentLeaderboard === 'string') {
            currentLeaderboard = JSON.parse(currentLeaderboard);
        }

        if (!Array.isArray(currentLeaderboard)) {
            currentLeaderboard = [];
            await kv.del('leaderboard');
            console.warn('Leaderboard data corrupted, resetting.');
        }

        const existingEntryIndex = currentLeaderboard.findIndex(entry => entry.userId === userId);

        if (existingEntryIndex !== -1) {
            // update skor hanya jika lebih tinggi
            if (score > currentLeaderboard[existingEntryIndex].score) {
                currentLeaderboard[existingEntryIndex].score = score;
            }
        } else {
            currentLeaderboard.push({ userId, username, score });
        }

        // simpan dalam bentuk JSON string
        await kv.set('leaderboard', JSON.stringify(currentLeaderboard));

        res.sendStatus(200);
    } catch (error) {
        console.error('Failed to save score to KV:', error);
        res.status(500).send('Error saving score');
    }
});

// ====================== AUTH DISCORD ======================

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

// Serve halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================== START SERVER ======================
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
