const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

// Pastikan .env sudah dimuat di proyek lokal Anda
// require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

let leaderboard = [];

const scopes = ['identify'];

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

app.use(session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// BARIS YANG DIPERBAIKI: Express sekarang tahu untuk menyajikan file dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rute untuk login Discord
app.get('/login', passport.authenticate('discord'));

// Rute callback setelah autentikasi
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/');
});

// Rute untuk mendapatkan status login pengguna
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Rute untuk mendapatkan dan menyimpan skor
app.get('/api/leaderboard', (req, res) => {
    const sortedLeaderboard = leaderboard.sort((a, b) => b.score - a.score).slice(0, 10);
    res.json(sortedLeaderboard);
});

app.post('/api/leaderboard', (req, res) => {
    const { userId, username, score } = req.body;
    
    const existingEntry = leaderboard.find(entry => entry.userId === userId);
    
    if (existingEntry) {
        if (score > existingEntry.score) {
            existingEntry.score = score;
        }
    } else {
        leaderboard.push({ userId, username, score });
    }
    
    res.sendStatus(200);
});

// BARIS YANG DIPERBAIKI: Sekarang melayani index.html dari dalam folder 'public'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
