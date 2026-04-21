import { config } from '../config.js';

export function basicAuth(request, response, next) {
  const { user, password } = config.panel;

  if (!user || !password) {
    next();
    return;
  }

  const authorization = request.headers.authorization || '';
  const [scheme, encoded] = authorization.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const reqUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const reqPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

    if (reqUser === user && reqPassword === password) {
      next();
      return;
    }
  }

  response
    .set('WWW-Authenticate', 'Basic realm="Kaspi Panel"')
    .status(401)
    .send('Authentication required');
}
