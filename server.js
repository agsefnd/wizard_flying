const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const RedisStore = require("connect-redis").default;
const Redis = require("ioredis");

// Inisialisasi Klien Redis untuk Express-Session & Leaderboard
const redisClient = new Redis(process.env.REDIS_URL || process.env.KV_REST_API_URL, {
    password: process.env.REDIS_PASSWORD || process.env.KV_REST_API_TOKEN,
    tls: {
      rejectUnauthorized: false
    }
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
    store: new RedisStore({ client: redisClient }), 
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// Melayani file statis dari direktori 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rute untuk mendapatkan leaderboard dari Redis Sorted Set
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsersWithScores = await redisClient.zrevrange('leaderboard', 0, 9, 'withscores');
        
        const topUserIds = [];
        const topScores = {};

        for (let i = 0; i < topUsersWithScores.length; i += 2) {
            topUserIds.push(topUsersWithScores[i]);
            topScores[topUsersWithScores[i]] = parseInt(topUsersWithScores[i+1]);
        }

        const usernames = await redisClient.hmget('usernames', ...topUserIds);
        
        const leaderboard = [];
        for (let i = 0; i < topUserIds.length; i++) {
            leaderboard.push({
                userId: topUserIds[i],
                username: usernames[i] || 'Anonymous',
                score: topScores[topUserIds[i]]
            });
        }
            
        res.json(leaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard from Redis:', error);
        res.status(500).send('Error fetching leaderboard');
    }
});

// Rute untuk mengirimkan skor ke Redis
app.post('/api/leaderboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const { userId, username, score } = req.body;

    if (!userId || !username || typeof score !== 'number') {
        return res.status(400).send('Invalid data provided.');
    }

    try {
        await redisClient.zadd('leaderboard', 'GT', score, userId);
        await redisClient.hset('usernames', userId, username);
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Failed to save score to Redis:', error);
        res.status(500).send('Error saving score');
    }
});

// Rute login dan autentikasi dengan penanganan kesalahan yang ditingkatkan
app.get('/login', passport.authenticate('discord'));

app.get('/auth/discord/callback', (req, res, next) => {
    passport.authenticate('discord', (err, user, info) => {
        if (err) {
            console.error('Discord authentication error:', err);
            return res.redirect('/login-error?message=' + encodeURIComponent(err.message || 'Authentication failed.'));
        }
        if (!user) {
            console.error('Discord authentication failed. No user found.');
            return res.redirect('/login-error?message=' + encodeURIComponent('Authentication failed. No user found.'));
        }
        
        req.logIn(user, (err) => {
            if (err) {
                console.error('Session login error:', err);
                return res.redirect('/login-error?message=' + encodeURIComponent(err.message || 'Session login failed.'));
            }
            res.redirect('/?authenticated=true');
        });
    })(req, res, next);
});

// Rute untuk menampilkan pesan error login
app.get('/login-error', (req, res) => {
    const errorMessage = req.query.message || 'Login failed. Please try again.';
    res.send(`
        <html>
            <head><title>Login Error</title></head>
            <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif; padding-top: 50px;">
                <h1>Login Gagal!</h1>
                <p>Ada yang salah saat mencoba login dengan Discord.</p>
                <p><strong>Pesan Kesalahan:</strong> ${errorMessage}</p>
                <p>Silakan kembali ke halaman utama dan coba lagi.</p>
                <a href="/" style="color: #ffcc00;">Kembali ke Game</a>
            </body>
        </html>
    `);
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
