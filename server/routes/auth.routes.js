import { Router } from 'express';
import { generateToken, generateRefreshToken, verifyToken, requireAuth } from '../auth-middleware.js';
import { decryptField } from '../crypto.js';
import { logError, logInfo } from '../utils/logger.js';
import { query } from '../db/pool.js';
import {
  generateRegistrationChallenge,
  verifyRegistration,
  generateAuthenticationChallenge,
  verifyAuthentication,
  userExcludeCredentials,
  getEnrolmentTokenUser,
  consumeEnrolmentToken,
} from '../services/auth/webauthn.js';

const router = Router();

const PASSWORD_AUTH_DISABLED = {
  error: 'password_auth_disabled',
  message: 'Password authentication has been replaced with passkeys. Ask an admin for an enrolment link.',
};

router.post('/login', (_req, res) => res.status(410).json(PASSWORD_AUTH_DISABLED));
router.post('/register', (_req, res) => res.status(410).json(PASSWORD_AUTH_DISABLED));

router.post('/passkey/authenticate/begin', async (_req, res) => {
  try {
    const { options, challengeId } = await generateAuthenticationChallenge();
    res.json({ options, challengeId });
  } catch (error) {
    logError('passkey authenticate/begin failed', error);
    res.status(500).json({ error: 'passkey_auth_failed', message: 'Failed to start passkey sign-in.' });
  }
});

router.post('/passkey/authenticate/finish', async (req, res) => {
  const { challengeId, response } = req.body ?? {};
  if (typeof challengeId !== 'string' || !response) {
    return res.status(400).json({ error: 'bad_request', message: 'challengeId and response are required.' });
  }

  try {
    const user = await verifyAuthentication({ challengeId, response });
    const token = generateToken({ userId: user.userId });
    const refreshToken = generateRefreshToken(user.userId);

    await query(`UPDATE user_profiles SET last_login = NOW() WHERE id = $1`, [user.userId]);

    logInfo('Passkey login', { telemetryEvent: 'auth.passkey.login', userId: user.userId });

    res.json({
      user: {
        id: user.userId,
        username: user.username,
        email: user.email,
        roles: user.roles,
        status: user.status,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      logError('passkey authenticate/finish failed', error);
    }
    res.status(status).json({
      error: 'passkey_auth_failed',
      message: error.message || 'Sign-in failed.',
    });
  }
});

router.post('/passkey/register/begin', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = decryptField(req.user.username);
    const exclude = await userExcludeCredentials(userId);
    const { options, challengeId } = await generateRegistrationChallenge({
      userId,
      username,
      excludeCredentialIds: exclude,
    });
    res.json({ options, challengeId });
  } catch (error) {
    logError('passkey register/begin failed', error);
    res.status(500).json({ error: 'passkey_register_failed', message: 'Failed to start passkey registration.' });
  }
});

router.post('/passkey/register/finish', requireAuth, async (req, res) => {
  const { challengeId, response, deviceName } = req.body ?? {};
  if (typeof challengeId !== 'string' || !response) {
    return res.status(400).json({ error: 'bad_request', message: 'challengeId and response are required.' });
  }
  try {
    await verifyRegistration({
      userId: req.user.id,
      challengeId,
      response,
      deviceName: typeof deviceName === 'string' ? deviceName.trim().slice(0, 80) : null,
    });
    res.json({ verified: true });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      logError('passkey register/finish failed', error);
    }
    res.status(status).json({
      error: 'passkey_register_failed',
      message: error.message || 'Registration failed.',
    });
  }
});

// Enrolment flow — public, gated by a one-time token.
router.get('/enrolment/:token', async (req, res) => {
  try {
    const user = await getEnrolmentTokenUser(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'invalid_token', message: 'This enrolment link is invalid or has expired.' });
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    logError('enrolment lookup failed', error);
    res.status(500).json({ error: 'enrolment_failed', message: 'Failed to load enrolment.' });
  }
});

router.post('/enrolment/:token/register/begin', async (req, res) => {
  try {
    const user = await getEnrolmentTokenUser(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'invalid_token', message: 'This enrolment link is invalid or has expired.' });
    }
    const exclude = await userExcludeCredentials(user.id);
    const { options, challengeId } = await generateRegistrationChallenge({
      userId: user.id,
      username: user.username,
      excludeCredentialIds: exclude,
    });
    res.json({ options, challengeId });
  } catch (error) {
    logError('enrolment register/begin failed', error);
    res.status(500).json({ error: 'enrolment_failed', message: 'Failed to start passkey registration.' });
  }
});

router.post('/enrolment/:token/register/finish', async (req, res) => {
  const { challengeId, response, deviceName } = req.body ?? {};
  if (typeof challengeId !== 'string' || !response) {
    return res.status(400).json({ error: 'bad_request', message: 'challengeId and response are required.' });
  }
  try {
    const user = await getEnrolmentTokenUser(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'invalid_token', message: 'This enrolment link is invalid or has expired.' });
    }

    await verifyRegistration({
      userId: user.id,
      challengeId,
      response,
      deviceName: typeof deviceName === 'string' ? deviceName.trim().slice(0, 80) : null,
    });

    // Consume the token so it can't be reused. If consumption fails (token expired between
    // the begin call and now) we still proceed — the credential is already saved.
    await consumeEnrolmentToken(req.params.token).catch((error) =>
      logError('enrolment token consume failed', error),
    );

    const token = generateToken({ userId: user.id });
    const refreshToken = generateRefreshToken(user.id);
    await query(`UPDATE user_profiles SET last_login = NOW() WHERE id = $1`, [user.id]);

    logInfo('Passkey enrolment completed', {
      telemetryEvent: 'auth.passkey.enrolled',
      userId: user.id,
    });

    res.json({
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
    const status = error.status || 500;
    if (status >= 500) {
      logError('enrolment register/finish failed', error);
    }
    res.status(status).json({
      error: 'enrolment_failed',
      message: error.message || 'Enrolment failed.',
    });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body ?? {};

  if (typeof refreshToken !== 'string' || !refreshToken) {
    return res.status(400).json({ error: 'refresh_token_required', message: 'Refresh token is required.' });
  }

  try {
    const decoded = verifyToken(refreshToken);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'invalid_token', message: 'Invalid refresh token.' });
    }

    const { rows } = await query(
      'SELECT id, username, email, roles, status FROM user_profiles WHERE id = $1 LIMIT 1',
      [decoded.userId],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'user_not_found', message: 'User not found.' });
    }

    const user = rows[0];

    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({
        error: 'account_suspended',
        message: 'Your account has been suspended.',
      });
    }

    const newToken = generateToken({ userId: user.id });
    const newRefreshToken = generateRefreshToken(user.id);

    return res.json({
      user: {
        id: user.id,
        username: decryptField(user.username),
        email: decryptField(user.email),
        roles: user.roles,
        status: user.status,
      },
      token: newToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    logError('Token refresh failed', error);
    return res.status(401).json({ error: 'refresh_failed', message: 'Invalid or expired refresh token.' });
  }
});

export const registerAuthRoutes = (app) => {
  app.use('/api/auth', router);
};
