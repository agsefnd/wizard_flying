const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
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
// PERBAIKAN: Konfigurasi session yang lebih robust
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: true, // Diubah menjadi true untuk menghindari session loss
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    },
    store: new session.MemoryStore() // Gunakan memory store untuk development
}));

// PERBAIKAN: Tambahkan middleware untuk parsing URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// PERBAIKAN: Tambahkan CORS headers untuk memastikan credentials bekerja
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(passport.initialize());
app.use(passport.session());

// PERBAIKAN: Pastikan static files dilayani dengan proper caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

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
        res.status(500).json({ error: 'Error fetching leaderboard' });
    }
});

// Rute untuk mengirimkan skor ke Vercel KV
app.post('/api/leaderboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        console.log('Unauthorized attempt to submit score from user:', req.user || 'unknown');
        return res.status(401).json({ error: 'Unauthorized - Please login again' });
    }

    const { userId, username, score } = req.body;

    // Validasi data
    if (!userId || !username || score === undefined) {
        return res.status(400).json({ error: 'Invalid data' });
    }

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
                console.log(`Updated score for user ${username} to ${score}`);
            }
        } else {
            // Jika user baru, tambahkan ke leaderboard
            currentLeaderboard.push({ userId, username, score });
            console.log(`Added new user ${username} with score ${score}`);
        }
        
        // Simpan kembali ke KV
        await kv.set('leaderboard', currentLeaderboard);
        
        res.json({ success: true, message: 'Score saved successfully' });
    } catch (error) {
        console.error('Failed to save score to KV:', error);
        res.status(500).json({ error: 'Error saving score' });
    }
});

// Rute login dan autentikasi
app.get('/login', passport.authenticate('discord'));

// PERBAIKAN: Callback route dengan penanganan session yang lebih baik
app.get('/auth/discord/callback', 
  passport.authenticate('discord', { 
    failureRedirect: '/?login=failed',
    failureMessage: true 
  }),
  (req, res) => {
    // Simpan session explicitly setelah login berhasil
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session after login:', err);
        return res.redirect('/?login=error');
      }
      console.log('User logged in successfully:', req.user.username);
      res.redirect('/');
    });
  }
);

// Rute untuk mendapatkan informasi user
app.get('/api/user', (req, res) => {
    console.log('Session info:', req.sessionID);
    console.log('Authenticated:', req.isAuthenticated());
    
    if (req.isAuthenticated()) {
        console.log('User data:', req.user);
        res.json({ 
            loggedIn: true, 
            user: {
                id: req.user.id,
                username: req.user.username,
                discriminator: req.user.discriminator,
                avatar: req.user.avatar
            }
        });
    } else {
        console.log('No authenticated user found');
        res.json({ loggedIn: false });
    }
});

// Rute logout
app.get('/logout', (req, res) => {
    const username = req.user ? req.user.username : 'unknown';
    req.logout(function(err) {
        if (err) {
            console.error('Logout error:', err);
        }
        req.session.destroy(function(err) {
            if (err) {
                console.error('Session destruction error:', err);
            }
            console.log(`User ${username} logged out successfully`);
            res.redirect('/');
        });
    });
});

// PERBAIKAN: Route untuk debug session
app.get('/api/debug-session', (req, res) => {
    res.json({
        sessionId: req.sessionID,
        authenticated: req.isAuthenticated(),
        user: req.user,
        session: req.session
    });
});

// Melayani halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Menangani error 404
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).send('Something broke!');
});

// Menjalankan server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Session secret: ${process.env.SESSION_SECRET ? 'Set' : 'Not set - using fallback'}`);
    console.log(`Discord Client ID: ${process.env.DISCORD_CLIENT_ID ? 'Set' : 'Not set'}`);
    console.log(`Redirect URI: ${process.env.REDIRECT_URI || 'Not set'}`);
});
