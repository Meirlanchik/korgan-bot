import crypto from 'node:crypto';
import { config } from './config.js';
import { getSetting } from './db.js';

const COOKIE_NAME = 'kaspi_panel_auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function hasPanelCredentialsConfigured() {
  const credentials = getPanelCredentials();
  return Boolean(credentials.user && credentials.password);
}

export function isAuthorizedByCookie(request) {
  if (!hasPanelCredentialsConfigured()) return true;

  const cookies = parseCookieHeader(request.headers.cookie || '');
  return cookies[COOKIE_NAME] === panelAuthToken();
}

export function isAuthorizedByHeaderToken(request) {
  if (!hasPanelCredentialsConfigured()) return true;
  return readHeader(request, 'x-kaspi-panel-auth') === panelAuthToken();
}

export function isAuthorizedByQueryToken(request) {
  if (!hasPanelCredentialsConfigured()) return true;

  try {
    const parsed = new URL(String(request.url || ''), 'http://localhost');
    return parsed.searchParams.get('panelAuth') === panelAuthToken();
  } catch {
    return false;
  }
}

export function isAuthorizedByBasicHeader(request) {
  if (!hasPanelCredentialsConfigured()) return true;

  const authorization = readHeader(request, 'authorization');
  const [scheme, encoded] = authorization.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const reqUser = separator >= 0 ? decoded.slice(0, separator) : '';
  const reqPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

  const credentials = getPanelCredentials();
  return reqUser === credentials.user && reqPassword === credentials.password;
}

export function setPanelAuthCookie(request, response) {
  if (!hasPanelCredentialsConfigured()) return;

  const cookie = [
    `${COOKIE_NAME}=${panelAuthToken()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];

  if (isSecureRequest(request)) {
    cookie.push('Secure');
  }

  response.append('Set-Cookie', cookie.join('; '));
}

export function getPanelAuthToken() {
  if (!hasPanelCredentialsConfigured()) return '';
  return panelAuthToken();
}

function panelAuthToken() {
  const credentials = getPanelCredentials();
  return crypto
    .createHash('sha256')
    .update(`${credentials.user}:${credentials.password}`)
    .digest('hex');
}

function getPanelCredentials() {
  try {
    return {
      user: getSetting('panel_user', config.panel.user),
      password: getSetting('panel_password', config.panel.password),
    };
  } catch {
    return {
      user: config.panel.user,
      password: config.panel.password,
    };
  }
}

function parseCookieHeader(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return acc;
      acc[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
      return acc;
    }, {});
}

function isSecureRequest(request) {
  return request.secure || String(request.headers['x-forwarded-proto'] || '').includes('https');
}

function readHeader(request, name) {
  if (typeof request.get === 'function') {
    return String(request.get(name) || '');
  }
  return String(request.headers?.[name] || '');
}
