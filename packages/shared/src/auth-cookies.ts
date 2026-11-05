/**
 * Cookie names shared by the API and the Next.js app.
 *
 * The session cookie is httpOnly. The CSRF cookie is readable so the Next
 * server (and same-origin browser scripts) can send it back as a header.
 */
export const SESSION_COOKIE = 'nfc_session';
export const CSRF_COOKIE = 'nfc_csrf';
export const MFA_CHALLENGE_COOKIE = 'nfc_mfa_challenge';
export const STEP_UP_COOKIE = 'nfc_stepup';

export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_IDLE_MINUTES_DEFAULT = 30;
export const SESSION_ABSOLUTE_HOURS_DEFAULT = 12;
export const LOGIN_LOCKOUT_THRESHOLD = 10;
export const LOGIN_LOCKOUT_MINUTES = 15;
export const STEP_UP_MINUTES_DEFAULT = 5;
