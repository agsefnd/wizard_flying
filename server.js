require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { kv } = require('@vercel/kv');
const cors = require('cors');

const app = express();

// === Middleware ===
app.use(express.json());

// ✅ Atur CORS biar frontend bisa akses API
app.use(cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
}));

// ✅ Session untuk login
app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production" }
}));

app.use(passport.initialize());
app.use(passport.session());

// === Passport Discord Strategy ===
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// === Routes ===
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect(process.env.FRONTEND_URL || '/');
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// === API Routes ===

// User info (buat frontend check login)
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        let leaderboard = await kv.get('leaderboard');

        if (!leaderboard) leaderboard = [];
        else if (typeof leaderboard === 'string') leaderboard = JSON.parse(leaderboard);

        if (!Array.isArray(leaderboard)) leaderboard = [];

        leaderboard.sort((a, b) => b.score - a.score);
        res.json(leaderboard);
    } catch (err) {
        console.error('Error reading leaderboard:', err);
        res.status(500).send('Error reading leaderboard');
    }
});

// Post score → hanya user login
app.post('/api/leaderboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const { score } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    if (typeof score !== 'number') {
        return res.status(400).send('Invalid score');
    }

    try {
        let leaderboard = await kv.get('leaderboard');

        if (!leaderboard) leaderboard = [];
        else if (typeof leaderboard === 'string') leaderboard = JSON.parse(leaderboard);

        if (!Array.isArray(leaderboard)) leaderboard = [];

        const idx = leaderboard.findIndex(e => e.userId === userId);
        if (idx !== -1) {
            if (score > leaderboard[idx].score) {
                leaderboard[idx].score = score;
            }
        } else {
            leaderboard.push({ userId, username, score });
        }

        await kv.set('leaderboard', JSON.stringify(leaderboard));
        res.json({ success: true, leaderboard });
    } catch (err) {
        console.error('Error saving score:', err);
        res.status(500).send('Error saving score');
    }
});

// === Start server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
