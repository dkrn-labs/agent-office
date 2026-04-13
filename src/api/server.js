import express from 'express';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';

/**
 * Creates and configures the Express application.
 *
 * @param {{
 *   repo: ReturnType<import('../db/repository.js').createRepository>,
 *   bus: ReturnType<import('../core/event-bus.js').createEventBus>,
 *   config: object,
 *   configDir: string,
 * }} options
 * @returns {import('express').Application}
 */
export function createApp({ repo, bus, config, configDir }) {
  const app = express();

  app.use(express.json());

  // Mount route modules
  app.use(healthRoutes());
  app.use(projectRoutes(repo));
  app.use(configRoutes(configDir));

  return app;
}
