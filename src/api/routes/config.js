import { Router } from 'express';
import { loadConfig, saveConfig } from '../../core/config.js';

/**
 * Returns an Express Router for config endpoints.
 * @param {string} configDir  Directory where config.json lives.
 * @returns {import('express').Router}
 */
export function configRoutes(configDir) {
  const router = Router();

  // GET /api/config — return current config
  router.get('/api/config', (_req, res) => {
    const config = loadConfig(configDir);
    res.json(config);
  });

  // PUT /api/config — merge body into current config, persist, return updated
  router.put('/api/config', (req, res) => {
    const current = loadConfig(configDir);
    const body = req.body ?? {};

    // Deep-merge one level for known nested objects (garden, personaPrompts)
    const updated = {
      ...current,
      ...body,
      garden: {
        ...current.garden,
        ...(body.garden ?? {}),
      },
      personaPrompts: {
        ...current.personaPrompts,
        ...(body.personaPrompts ?? {}),
      },
    };

    saveConfig(updated, configDir);
    res.json(updated);
  });

  return router;
}
