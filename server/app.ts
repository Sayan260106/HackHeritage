import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import apiRouter from './routes/index.ts';
import gisRouter from './routes/gis.ts';
import pfzRouter from './routes/pfz.ts';
import routingRouter from './routes/routing.ts';
import alertsRouter from './routes/alerts.ts';
import indicVoiceRouter from './routes/indicVoice.ts';
import { errorHandler, notFound } from './middleware/errorHandler.ts';
import { startMarineTelemetryCollector } from './services/realtime/marineTelemetryCollector.ts';

export const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.ORCA_PRODUCTION === 'true';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);
app.use('/api/gis', gisRouter);
app.use('/api/pfz', pfzRouter);
app.use('/api/routing', routingRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/indic-voice', indicVoiceRouter);

async function startServer() {
  if (!IS_PRODUCTION) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORCA-X server running on http://0.0.0.0:${PORT}`);
    startMarineTelemetryCollector();
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(error => {
    console.error('Failed to start ORCA-X server:', error);
    process.exit(1);
  });
}
