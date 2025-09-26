import { Router } from 'express';
import { comparePassword, generateToken, generateRefreshToken, hashPassword } from '../auth-middleware.js';
import { logError, logInfo } from '../utils/logger.js';
import { query } from '../db/pool.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email_required', message: 'Email is required.' });
  }

  try {
    const { rows } = await query(
      `SELECT id, username, email, password_hash, roles, status
         FROM user_profiles
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [email.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
    }

    const user = rows[0];
    const passwordMatches = password ? await comparePassword(password, user.password_hash) : false;

    if (!passwordMatches) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
    }

    const token = generateToken({ userId: user.id });
    const refreshToken = generateRefreshToken();

    logInfo('User logged in', {
      telemetryEvent: 'auth.login',
      userId: user.id,
    });

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
        status: user.status,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    logError('Authentication failed', error, { email });
    return res.status(500).json({ error: 'auth_failed', message: 'Failed to sign in.' });
  }
});

router.post('/register', async (req, res) => {
  const { username, email, password, roles = ['player'] } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username_required', message: 'Username is required.' });
  }

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email_required', message: 'Email is required.' });
  }

  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'password_required', message: 'Password must be at least 6 characters.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await query(
      'SELECT id FROM user_profiles WHERE lower(email) = $1 LIMIT 1',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'email_in_use', message: 'Email address already registered.' });
    }

    const passwordHash = await hashPassword(password);

    const { rows } = await query(
      `INSERT INTO user_profiles (username, email, password_hash, roles, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, username, email, roles, status`,
      [username.trim(), normalizedEmail, passwordHash, roles]
    );

    const user = rows[0];
    const token = generateToken({ userId: user.id });
    const refreshToken = generateRefreshToken();

    logInfo('User registered', {
      telemetryEvent: 'auth.register',
      userId: user.id,
    });

    return res.status(201).json({ user, token, refreshToken });
  } catch (error) {
    logError('Registration failed', error, { email });
    return res.status(500).json({ error: 'registration_failed', message: 'Failed to create account.' });
  }
});

export const registerAuthRoutes = (app) => {
  app.use('/api/auth', router);
};
