import { Router } from 'express';

export function portfolioRoutes(portfolioStats) {
  const router = Router();

  router.get('/api/portfolio/stats', async (req, res) => {
    const force = req.query?.refresh === '1';
    try {
      const stats = await portfolioStats.getAll({ force });
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Failed to compute portfolio stats' });
    }
  });

  return router;
}
