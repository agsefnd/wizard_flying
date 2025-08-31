const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const { createClient } = require('@vercel/kv');

// Inisialisasi Klien Vercel KV
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
    console.log('Serializing user:', user.id);
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    console.log('Deserializing user:', obj.id);
    done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI,
    scope: scopes
}, function(accessToken, refreshToken, profile, done) {
    console.log('Discord authentication successful for:', profile.username);
    process.nextTick(function() {
        return done(null, profile);
    });
}));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// PERBAIKAN PENTING: Konfigurasi session yang benar
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: true,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    },
    store: new session.MemoryStore()
}));

app.use(passport.initialize());
app.use(passport.session());

// Middleware untuk logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// PERBAIKAN: CORS configuration untuk development dan production
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', process.env.PRODUCTION_URL];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/api/leaderboard', async (req, res) => {
    try {
        let leaderboardData = await kv.get('leaderboard') || [];
        
        if (!Array.isArray(leaderboardData)) {
            await kv.del('leaderboard');
            leaderboardData = [];
            console.warn('Leaderboard data was corrupted. Resetting.');
        }

        const sortedLeaderboard = leaderboardData
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
            
        res.json(sortedLeaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
        res.status(500).json({ error: 'Error fetching leaderboard' });
    }
});

app.post('/api/leaderboard', async (req, res) => {
    console.log('Score submission attempt by:', req.user ? req.user.username : 'Unauthenticated user');
    
    if (!req.isAuthenticated()) {
        console.log('Unauthorized score submission attempt');
        return res.status(401).json({ error: 'Unauthorized - Please login again' });
    }

    const { userId, username, score } = req.body;

    if (!userId || !username || score === undefined) {
        return res.status(400).json({ error: 'Invalid data' });
    }

    try {
        let currentLeaderboard = await kv.get('leaderboard') || [];
        
        if (!Array.isArray(currentLeaderboard)) {
            await kv.del('leaderboard');
            currentLeaderboard = [];
            console.warn('Leaderboard data was corrupted. Resetting.');
        }

        const existingEntryIndex = currentLeaderboard.findIndex(entry => entry.userId === userId);

        if (existingEntryIndex !== -1) {
            if (score > currentLeaderboard[existingEntryIndex].score) {
                currentLeaderboard[existingEntryIndex].score = score;
                currentLeaderboard[existingEntryIndex].username = username;
                console.log(`Updated score for ${username} to ${score}`);
            }
        } else {
            currentLeaderboard.push({ userId, username, score });
            console.log(`Added new entry for ${username} with score ${score}`);
        }
        
        await kv.set('leaderboard', currentLeaderboard);
        
        res.json({ success: true, message: 'Score saved successfully' });
    } catch (error) {
        console.error('Failed to save score:', error);
        res.status(500).json({ error: 'Error saving score' });
    }
});

// PERBAIKAN: Login route dengan state parameter
app.get('/login', (req, res, next) => {
    console.log('Login attempt initiated');
    const state = Math.random().toString(36).substring(2);
    req.session.oauthState = state;
    
    passport.authenticate('discord', {
        state: state,
        failureRedirect: '/?login=failed'
    })(req, res, next);
});

// PERBAIKAN: Callback route dengan penanganan state dan error
app.get('/auth/discord/callback', (req, res, next) => {
    console.log('Discord callback received');
    
    // Check state parameter to prevent CSRF
    if (req.query.state !== req.session.oauthState) {
        console.error('State parameter mismatch');
        return res.redirect('/?login=error&reason=state_mismatch');
    }
    
    passport.authenticate('discord', { 
        failureRedirect: '/?login=failed',
        failureMessage: true 
    }, (err, user, info) => {
        if (err) {
            console.error('Authentication error:', err);
            return res.redirect('/?login=error');
        }
        if (!user) {
            console.error('Authentication failed:', info);
            return res.redirect('/?login=failed');
        }
        
        req.logIn(user, (err) => {
            if (err) {
                console.error('Login error:', err);
                return res.redirect('/?login=error');
            }
            
            console.log('User successfully logged in:', user.username);
            
            // Clear the state after successful authentication
            req.session.oauthState = null;
            
            // Redirect to home with success message
            return res.redirect('/?login=success');
        });
    })(req, res, next);
});

app.get('/api/user', (req, res) => {
    console.log('User status check - Authenticated:', req.isAuthenticated());
    
    if (req.isAuthenticated()) {
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
        res.json({ loggedIn: false });
    }
});

app.get('/logout', (req, res) => {
    const username = req.user ? req.user.username : 'unknown';
    console.log(`Logout request for user: ${username}`);
    
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/?logout=error');
        }
        
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
            console.log(`User ${username} logged out successfully`);
            res.redirect('/');
        });
    });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
    res.json({
        sessionId: req.sessionID,
        authenticated: req.isAuthenticated(),
        user: req.user,
        session: {
            cookie: req.session.cookie,
            oauthState: req.session.oauthState
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Session secret: ${process.env.SESSION_SECRET ? 'Set' : 'Not set - using fallback'}`);
    console.log(`Discord Client ID: ${process.env.DISCORD_CLIENT_ID ? 'Set' : 'Not set'}`);
    console.log(`Redirect URI: ${process.env.REDIRECT_URI || 'Not set'}`);
    
    // Check if all required environment variables are set
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.REDIRECT_URI) {
        console.warn('WARNING: Required environment variables are not set!');
        console.warn('Please set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and REDIRECT_URI');
    }
});
