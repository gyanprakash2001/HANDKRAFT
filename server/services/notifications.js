const User = require('../models/User');

/**
 * Send a push notification to a specific user by their ID.
 * @param {string} userId - Target user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification message body
 * @param {object} data - Optional extra data payload
 */
async function sendPushNotification(userId, title, body, data = {}) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.pushToken) {
      return { success: false, reason: 'User has no registered push token' };
    }

    const message = {
      to: user.pushToken,
      sound: 'default',
      title,
      body,
      data,
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendPushNotification,
};
