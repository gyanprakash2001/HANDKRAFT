// middleware/admin.js
// Middleware to check if the user is an admin

module.exports = function (req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};
