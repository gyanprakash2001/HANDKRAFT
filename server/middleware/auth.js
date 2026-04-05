const jwt = require('jsonwebtoken');

const User = require('../models/User');
module.exports = async function (req, res, next) {
  const authHeader = req.header('Authorization') || req.header('authorization');
  const token = authHeader && authHeader.split(' ')[0] === 'Bearer' ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    try {
      console.log('[AUTH] decoded.id:', decoded.id, 'loaded user._id:', user?._id, 'userType:', typeof user);
    } catch (e) {
      console.log('[AUTH] failed to log user debug:', e?.message || e);
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token is not valid' });
  }
};
