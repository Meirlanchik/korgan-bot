import {
  hasPanelCredentialsConfigured,
  isAuthorizedByBasicHeader,
  isAuthorizedByCookie,
  isAuthorizedByHeaderToken,
  setPanelAuthCookie,
} from '../panelAuth.js';

export function basicAuth(request, response, next) {
  if (!hasPanelCredentialsConfigured()) {
    next();
    return;
  }

  if (isAuthorizedByCookie(request)) {
    next();
    return;
  }

  if (isAuthorizedByHeaderToken(request)) {
    next();
    return;
  }

  if (isAuthorizedByBasicHeader(request)) {
    setPanelAuthCookie(request, response);
    next();
    return;
  }

  if (wantsJsonResponse(request)) {
    response.status(401).json({
      ok: false,
      error: 'Сессия панели истекла. Обновите страницу и войдите снова.',
      unauthorized: true,
    });
    return;
  }

  response
    .set('WWW-Authenticate', 'Basic realm="Kaspi Panel"')
    .status(401)
    .send('Authentication required');
}

function wantsJsonResponse(request) {
  const accept = String(request.get('accept') || '');
  return request.get('x-kaspi-async') === '1' || accept.includes('application/json');
}
