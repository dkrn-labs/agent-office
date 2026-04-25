import { loadConfig, saveConfig } from '../../core/config.js';

/**
 * @param {string} configDir
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function configRoutes(configDir) {
  return async function plugin(fastify) {
    fastify.get('/api/config', async () => loadConfig(configDir));

    fastify.put('/api/config', async (req) => {
      const current = loadConfig(configDir);
      const body = req.body ?? {};
      const updated = {
        ...current,
        ...body,
        garden: { ...current.garden, ...(body.garden ?? {}) },
        personaPrompts: { ...current.personaPrompts, ...(body.personaPrompts ?? {}) },
      };
      saveConfig(updated, configDir);
      return updated;
    });
  };
}
