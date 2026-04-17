
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middleware/auth');

const GOOGLE_AUDIENCE_KEYS = [
  'GOOGLE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
];

function getAllowedGoogleAudiences() {
  const set = new Set();
  for (const key of GOOGLE_AUDIENCE_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      set.add(value.trim());
    }
  }
  return Array.from(set);
}

const googleClient = new OAuth2Client();

// Avatar pool: use local in-app avatars (local:avatarNN)
const AVATAR_POOL = Array.from({ length: 30 }, (_, i) => `local:avatar${String(i + 1).padStart(2, '0')}`);

function splitNameParts(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function buildPublicUserPayload(user) {
  return {
    id: user._id,
    name: user.name,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    googleId: user.googleId || null,
    authProvider: user.authProvider || 'local',
    avatarUrl: user.avatarUrl || '',
    phoneNumber: user.phoneNumber || '',
    locale: user.locale || '',
    isAdmin: Boolean(user.isAdmin),
  };
}

// profile (get current user)
router.get('/profile', auth, async (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  const user = buildPublicUserPayload(req.user);
  res.json({ user: { ...user, isAdmin: req.user.isAdmin } });
});

// signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedName || !normalizedEmail || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(400).json({ message: 'User already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const { firstName, lastName } = splitNameParts(normalizedName);
    // Assign a random neutral avatar from the pool
    const avatarUrl = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
    const user = new User({
      name: normalizedName,
      firstName,
      lastName,
      email: normalizedEmail,
      password: hashed,
      authProvider: 'local',
      avatarUrl,
    });
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d',
    });
    res.json({ token, user: buildPublicUserPayload(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (!user.password) {
      return res.status(400).json({ message: 'This account uses Google sign-in. Please continue with Google.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d',
    });
    res.json({ token, user: buildPublicUserPayload(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Google sign-in / sign-up
router.post('/google', async (req, res) => {
  try {
    const { idToken, accessToken } = req.body || {};
    if (!idToken && !accessToken) {
      return res.status(400).json({ message: 'Missing Google token (idToken/accessToken)' });
    }

    let email;
    let name;
    let sub;
    let picture;
    let email_verified;
    let given_name;
    let family_name;
    let locale;

    if (idToken) {
      const allowedAudiences = getAllowedGoogleAudiences();
      if (allowedAudiences.length === 0) {
        return res.status(500).json({
          message:
            'Google audience is not configured. Set GOOGLE_CLIENT_ID or EXPO_PUBLIC_GOOGLE_* client IDs on server.',
        });
      }

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: allowedAudiences,
      });
      const payload = ticket.getPayload();
      if (!payload) return res.status(400).json({ message: 'Invalid token payload' });

      ({ email, name, sub, picture, email_verified, given_name, family_name, locale } = payload);
    } else {
      // Fallback path when only accessToken is available from native Google sign-in.
      const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userInfoRes.ok) {
        const txt = await userInfoRes.text().catch(() => '');
        console.warn('Google userinfo request failed', userInfoRes.status, txt);
        return res.status(401).json({ message: 'Invalid Google access token' });
      }

      const userInfo = await userInfoRes.json();
      ({ email, name, sub, picture, email_verified, given_name, family_name, locale } = userInfo || {});
    }

    if (!email || !sub) return res.status(400).json({ message: 'Invalid token payload' });

    if (email_verified === 'false' || email_verified === false) {
      console.warn('Signing in with unverified Google email:', email);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const baseNameFallback = normalizedEmail.split('@')[0];
    const normalizedFirstName = String(given_name || '').trim();
    const normalizedLastName = String(family_name || '').trim();
    const fullNameFromParts = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ').trim();
    const resolvedName = String(name || fullNameFromParts || baseNameFallback).trim();
    const fallbackNameParts = splitNameParts(resolvedName);
    const resolvedFirstName = normalizedFirstName || fallbackNameParts.firstName;
    const resolvedLastName = normalizedLastName || fallbackNameParts.lastName;
    const resolvedLocale = String(locale || '').trim();
    const isEmailVerified = email_verified === true || email_verified === 'true';

    // Optionally use the OAuth2 access token (if client provided) to fetch
    // additional profile details from Google People API (e.g., phone numbers).
    let phoneNumber = '';
    if (accessToken) {
      try {
        const peopleRes = await fetch(
          'https://people.googleapis.com/v1/people/me?personFields=phoneNumbers',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (peopleRes.ok) {
          const peopleJson = await peopleRes.json();
          const phones = peopleJson?.phoneNumbers;
          if (Array.isArray(phones) && phones.length > 0 && phones[0].value) {
            phoneNumber = phones[0].value;
          }
        } else {
          const txt = await peopleRes.text().catch(() => '');
          console.warn('People API request failed', peopleRes.status, txt);
        }
      } catch (pErr) {
        console.warn('People API fetch error:', pErr);
      }
    }

    // Find existing user by googleId or email
    let user = await User.findOne({ $or: [{ googleId: sub }, { email: normalizedEmail }] });
    if (!user) {
      // Create a new user for first-time Google sign-in
      user = new User({
        name: resolvedName || baseNameFallback,
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        email: normalizedEmail,
        emailVerified: isEmailVerified,
        password: '',
        googleId: sub,
        authProvider: 'google',
        avatarUrl: picture || '',
        phoneNumber: phoneNumber || '',
        locale: resolvedLocale,
      });
      await user.save();
    } else {
      // Link existing account to Google if not linked and backfill missing profile fields.
      let shouldSave = false;

      if (!user.googleId) {
        user.googleId = sub;
        user.authProvider = 'google';
        shouldSave = true;
      }
      if (resolvedName && (!user.name || user.name === baseNameFallback)) {
        user.name = resolvedName;
        shouldSave = true;
      }
      if (resolvedFirstName && !user.firstName) {
        user.firstName = resolvedFirstName;
        shouldSave = true;
      }
      if (resolvedLastName && !user.lastName) {
        user.lastName = resolvedLastName;
        shouldSave = true;
      }
      if (resolvedLocale && !user.locale) {
        user.locale = resolvedLocale;
        shouldSave = true;
      }
      if (isEmailVerified && !user.emailVerified) {
        user.emailVerified = true;
        shouldSave = true;
      }
      if (!user.avatarUrl && picture) {
        user.avatarUrl = picture;
        shouldSave = true;
      }
      if (phoneNumber && !user.phoneNumber) {
        user.phoneNumber = phoneNumber;
        shouldSave = true;
      }

      if (shouldSave) {
        await user.save();
      }
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d',
    });

    res.json({ token, user: buildPublicUserPayload(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
