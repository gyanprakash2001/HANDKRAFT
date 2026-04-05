import type { AppUser } from './api';

type CurrentUserProfile = (Partial<AppUser> & { avatarUrl?: string | null }) | null;
type Listener = (profile: CurrentUserProfile) => void;

let profile: CurrentUserProfile = null;
const listeners = new Set<Listener>();

function setProfile(next: CurrentUserProfile) {
  profile = next;
  for (const cb of Array.from(listeners)) cb(profile);
}

function setAvatar(avatarUrl: string | null) {
  profile = Object.assign({}, profile || {}, { avatarUrl });
  for (const cb of Array.from(listeners)) cb(profile);
}

function getProfile() {
  return profile;
}

function subscribe(cb: Listener) {
  listeners.add(cb);
  // immediate call with current state
  try { cb(profile); } catch (e) { /* ignore */ }
  return () => listeners.delete(cb);
}

export default {
  setProfile,
  setAvatar,
  getProfile,
  subscribe,
};
