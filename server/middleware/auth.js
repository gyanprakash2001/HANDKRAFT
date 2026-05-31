const jwt = require('jsonwebtoken');

const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const IS_PRODUCTION = String(process.env.NODE_ENV || 'development').trim().toLowerCase() === 'production';

module.exports = async function (req, res, next) {
  const authHeader = req.header('Authorization') || req.header('authorization');
  const token = authHeader && authHeader.split(' ')[0] === 'Bearer' ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
  try {
    if (IS_PRODUCTION && JWT_SECRET === 'secret') {
      return res.status(500).json({ message: 'Server authentication is not configured' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('_id name firstName lastName email emailVerified googleId authProvider avatarUrl phoneNumber locale isAdmin adminRole accountStatus');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (String(user.accountStatus || 'active') === 'suspended') {
      return res.status(403).json({ message: 'Your account is suspended. Please contact support.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token is not valid' });
  }
};
