import express from 'express';
import { requireAuth, requireOwner } from '../../lib/session.js';

const router = express.Router();

/*
 * READ ONLY. Deliberately, and permanently.
 *
 * There is no POST here, no PATCH and no DELETE, and there never will be. The
 * log is written by lib/audit.js from inside the actions being recorded — an
 * endpoint that accepted events would let anything claim anything happened, and
 * one that edited them would defeat the whole point.
 *
 * Postgres is not enforcing that today; the application is. Hardening it
 * properly means a database role with INSERT and SELECT but no UPDATE or DELETE
 * on this table, set up at deploy time. Worth doing before the pilot hospital
 * goes live, and noted here rather than in someone's head.
 */

router.use(requireAuth);

/*
 * Owner-only for now — the placeholder, like everywhere else.
 *
 * Milestone 06 replaces this with requirePermission('audit.read'), and that is
 * a permission very few roles should carry: the audit log names who did what,
 * and reading it is itself an act worth controlling.
 */
router.use(requireOwner);

router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.take) || 50, 200);
    const skip = Number(req.query.skip) || 0;

    const where = {};
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.actorId) where.actorId = Number(req.query.actorId);
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.entityId) where.entityId = String(req.query.entityId);
    if (req.query.outcome) where.outcome = String(req.query.outcome);

    const [events, total] = await Promise.all([
      req.prisma.auditEvent.findMany({
        where,
        orderBy: { at: 'desc' },   // newest first, always
        take,
        skip
      }),
      req.prisma.auditEvent.count({ where })
    ]);

    res.json({ events, total, take, skip });
  } catch (err) {
    next(err);
  }
});

/**
 * Everything that has happened to one thing.
 *
 * "Show me this patient's history" is the question an investigation actually
 * asks, so it gets its own route rather than being assembled from query
 * parameters each time.
 */
router.get('/:entity/:entityId', async (req, res, next) => {
  try {
    const events = await req.prisma.auditEvent.findMany({
      where: {
        entity: req.params.entity,
        entityId: String(req.params.entityId)
      },
      orderBy: { at: 'desc' },
      take: 200
    });

    res.json({ events, entity: req.params.entity, entityId: req.params.entityId });
  } catch (err) {
    next(err);
  }
});

export default router;
