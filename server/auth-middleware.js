// Authentication and authorization middleware
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';

// JWT secret key - in production this should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// Database pool - this should be passed from the main server file
let dbPool;

export const setDatabasePool = (pool) => {
  dbPool = pool;
};

// Password hashing utilities
export const hashPassword = async (password) => {
  try {
    const saltRounds = BCRYPT_ROUNDS;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Password hashing failed');
  }
};

export const comparePassword = async (password, hashedPassword) => {
  try {
    const isMatch = await bcrypt.compare(password, hashedPassword);
    return isMatch;
  } catch (error) {
    console.error('Error comparing password:', error);
    throw new Error('Password comparison failed');
  }
};

// JWT token utilities
export const generateToken = (payload) => {
  try {
    const token = jwt.sign(payload, JWT_SECRET, { 
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'questables-app',
      audience: 'questables-users'
    });
    return token;
  } catch (error) {
    console.error('Error generating JWT token:', error);
    throw new Error('Token generation failed');
  }
};

export const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'questables-app',
      audience: 'questables-users'
    });
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      console.error('Error verifying JWT token:', error);
      throw new Error('Token verification failed');
    }
  }
};

// Refresh token generation
export const generateRefreshToken = () => {
  const payload = { 
    type: 'refresh',
    timestamp: Date.now()
  };
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: '7d',
    issuer: 'questables-app',
    audience: 'questables-users'
  });
};

// Authentication middleware
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please provide a valid authentication token'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      const decoded = verifyToken(token);
      
      // Verify user still exists in database
      const userQuery = 'SELECT id, username, email, role, created_at FROM user_profiles WHERE id = $1';
      const userResult = await dbPool.query(userQuery, [decoded.userId]);
      
      if (userResult.rows.length === 0) {
        return res.status(401).json({ 
          error: 'Authentication failed',
          message: 'User not found'
        });
      }
      
      req.user = userResult.rows[0];
      req.token = decoded;
      next();
      
    } catch (tokenError) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: tokenError.message
      });
    }
    
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication system error',
      message: 'Please try again'
    });
  }
};

// Campaign ownership middleware
export const requireCampaignOwnership = async (req, res, next) => {
  try {
    const { campaignId, id } = req.params;
    const userId = req.user?.id || req.token?.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User authentication is required'
      });
    }
    
    const checkId = campaignId || id;
    if (!checkId) {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: 'Campaign ID is required'
      });
    }
    
    // Check if user is the DM of this campaign
    const campaignQuery = 'SELECT dm_id FROM campaigns WHERE id = $1';
    const campaignResult = await dbPool.query(campaignQuery, [checkId]);
    
    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Campaign not found',
        message: 'The specified campaign does not exist'
      });
    }
    
    const dmId = campaignResult.rows[0].dm_id;
    if (dmId !== userId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Only the campaign DM can perform this action'
      });
    }
    
    next();
    
  } catch (error) {
    console.error('Campaign ownership check error:', error);
    res.status(500).json({ 
      error: 'Authorization system error',
      message: 'Please try again'
    });
  }
};

// Campaign participation middleware (DM or player)
export const requireCampaignParticipation = async (req, res, next) => {
  try {
    const { campaignId, id } = req.params;
    const userId = req.user?.id || req.token?.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User authentication is required'
      });
    }
    
    const checkId = campaignId || id;
    if (!checkId) {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: 'Campaign ID is required'
      });
    }
    
    // Check if user is DM or player in this campaign
    const participationQuery = `
      SELECT 
        c.dm_id,
        CASE 
          WHEN c.dm_id = $2 THEN 'dm'
          WHEN cp.user_id = $2 THEN 'player'
          ELSE NULL
        END as role
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.user_id = $2
      WHERE c.id = $1
    `;
    
    const participationResult = await dbPool.query(participationQuery, [checkId, userId]);
    
    if (participationResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Campaign not found',
        message: 'The specified campaign does not exist'
      });
    }
    
    const userRole = participationResult.rows[0].role;
    if (!userRole) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You must be a participant in this campaign to access this resource'
      });
    }
    
    req.campaignRole = userRole;
    next();
    
  } catch (error) {
    console.error('Campaign participation check error:', error);
    res.status(500).json({ 
      error: 'Authorization system error',
      message: 'Please try again'
    });
  }
};

// Character ownership middleware
export const requireCharacterOwnership = async (req, res, next) => {
  try {
    const { characterId, id } = req.params;
    const userId = req.user?.id || req.token?.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User authentication is required'
      });
    }
    
    const checkId = characterId || id;
    if (!checkId) {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: 'Character ID is required'
      });
    }
    
    // Check if user owns this character
    const characterQuery = 'SELECT user_id FROM characters WHERE id = $1';
    const characterResult = await dbPool.query(characterQuery, [checkId]);
    
    if (characterResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Character not found',
        message: 'The specified character does not exist'
      });
    }
    
    const characterOwnerId = characterResult.rows[0].user_id;
    if (characterOwnerId !== userId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You can only access your own characters'
      });
    }
    
    next();
    
  } catch (error) {
    console.error('Character ownership check error:', error);
    res.status(500).json({ 
      error: 'Authorization system error',
      message: 'Please try again'
    });
  }
};

// Role-based access control
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      const userRole = req.user?.role || 'player';
      
      if (typeof allowedRoles === 'string') {
        allowedRoles = [allowedRoles];
      }
      
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`
        });
      }
      
      next();
      
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({ 
        error: 'Authorization system error',
        message: 'Please try again'
      });
    }
  };
};

// Rate limiting for authentication endpoints
export const authRateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs for auth endpoints
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
};