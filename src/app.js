import express from 'express';
import { basicAuth } from './middleware/auth.js';
import { renderError } from './views/error.js';
import apiRouter from './routes/api.js';
import panelRouter from './routes/panel.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(['/panel', '/api'], basicAuth);
  app.use('/api', apiRouter);
  app.use('/panel', panelRouter);

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).type('html').send(renderError(error));
  });

  return app;
}
