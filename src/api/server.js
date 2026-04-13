import express from 'express';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';
import { personaRoutes } from './routes/personas.js';
import { skillRoutes } from './routes/skills.js';
import { officeRoutes } from './routes/office.js';
import { createSkillResolver } from '../agents/skill-resolver.js';
import { createLauncher } from '../agents/launcher.js';

/**
 * Creates and configures the Express application.
 *
 * @param {{
 *   repo: ReturnType<import('../db/repository.js').createRepository>,
 *   bus: ReturnType<import('../core/event-bus.js').createEventBus>,
 *   config: object,
 *   configDir: string,
 *   db?: import('better-sqlite3').Database,
 *   dryRun?: boolean,
 * }} options
 * @returns {import('express').Application}
 */
export function createApp({ repo, bus, config, configDir, db, dryRun = true }) {
  const app = express();

  app.use(express.json());

  // Skill resolver uses repo.listSkills() — pass repo as the "db" argument
  // (createSkillResolver's param is named db but only calls .listSkills())
  const resolver = createSkillResolver(repo);
  const launcher = createLauncher({ repo, bus, resolver, dryRun });

  // Mount route modules
  app.use(healthRoutes());
  app.use(projectRoutes(repo));
  app.use(configRoutes(configDir));
  app.use(personaRoutes(repo));
  app.use(skillRoutes(repo));
  app.use(officeRoutes(launcher));

  return app;
}
