import express from 'express';
import cors from 'cors';
import multer from 'multer';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

import { app as langGraphApp } from './graph.js';

// --- Environment Variable Check ---
// This ensures the application doesn't start without a critical security setting.
if (!process.env.SESSION_SECRET) {
  console.error('FATAL ERROR: SESSION_SECRET is not defined in your .env file.');
  console.error('Please add SESSION_SECRET="your_random_secret_string" to the .env file in the /server directory.');
  process.exit(1); // Exit the application
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = express();
const PORT = 3001;

// --- Middleware Setup ---
const upload = multer({ dest: 'uploads/' });

// Allow requests from the Vite development server, with credentials
server.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
server.use(express.json());

// Session Middleware
server.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    secure: false, // Set to true if using HTTPS in production
  },
}));

// Passport Middleware
server.use(passport.initialize());
server.use(passport.session());

// --- Passport Configuration ---

// This stores the user's info in the session
passport.serializeUser((user, done) => {
  done(null, user);
});

// This retrieves the user's info from the session
passport.deserializeUser((user, done) => {
  done(null, user);
});

// Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    scope: ['profile', 'email']
  },
  (accessToken, refreshToken, profile, done) => {
    // In a real app, you would find or create a user in your database here.
    // For this example, we just pass the profile information to the session.
    return done(null, { id: profile.id, name: profile.displayName, provider: 'google' });
  }
));

// GitHub Strategy
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: "/auth/github/callback",
    scope: ['read:user']
  },
  (accessToken, refreshToken, profile, done) => {
    return done(null, { id: profile.id, name: profile.username, provider: 'github' });
  }
));

// --- Authentication Routes ---

// Initiates the Google login flow
server.get('/auth/google', passport.authenticate('google'));

// Google callback route - handles the redirect from Google
server.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: 'http://localhost:5173' }),
  (req, res) => {
    // Successful authentication, redirect to the client's main page.
    res.redirect('http://localhost:5173');
  }
);

// Initiates the GitHub login flow
server.get('/auth/github', passport.authenticate('github'));

// GitHub callback route
server.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: 'http://localhost:5173' }),
  (req, res) => {
    res.redirect('http://localhost:5173');
  }
);

// Route for the client to check if a user is currently logged in
server.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    // 401 Unauthorized is the standard response for no active session
    res.status(401).json({ user: null });
  }
});

// Route to log the user out
server.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.status(200).send('Logged out');
  });
});

// --- API Protection Middleware ---
// This function checks if a user is authenticated before allowing access to a route.
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'User not authenticated' });
};

// --- Main Chat Endpoint (Now Protected) ---
server.post('/chat', ensureAuthenticated, upload.single('file'), async (req, res) => {
  const userInput = req.body.prompt;
  const file = req.file;

  if (!userInput) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const inputs = {
    input: userInput,
    filePath: file ? path.join(__dirname, file.path) : null,
  };

  try {
    const finalState = await langGraphApp.invoke(inputs);
    res.json({ response: finalState.response });
  } catch (error) {
    console.error('Error invoking LangGraph app:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
