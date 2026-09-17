/**
 * @swagger
 * resourcePath: /obs-slots
 * description: Express API for OBS browser-source slots - stable overlay links that can be reassigned to any match.
 */
import { Router, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { RowDataPacket } from "mysql2";
import { db } from "../services/db.js";
import Utils from "../utility/utils.js";

const router = Router();

function requireCastOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (!Utils.castCheck(req.user) && !Utils.adminCheck(req.user))) {
    res.status(403).json({ message: "Access reserved to users with the cast role." });
    return;
  }
  next();
}

const SLOT_SELECT =
  "SELECT s.id, s.label, s.slug, s.match_id, " +
  "m.team1_string, m.team2_string, m.cancelled, m.end_time, m.max_maps " +
  "FROM obs_slot s LEFT JOIN `match` m ON m.id = s.match_id ";

async function generateUniqueSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomBytes(4).toString("hex");
    const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE slug = ?", [slug]);
    if (!existing.length) return slug;
  }
  throw new Error("Unable to generate a unique OBS slot slug.");
}

/**
 * @swagger
 *
 * /obs-slots/public/{slug}:
 *   get:
 *     description: Resolve an OBS slot's slug to its assigned match, with no authentication - used by OBS browser sources.
 *     tags:
 *       - obs-slots
 *     parameters:
 *       - in: path
 *         name: slug
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: The slot's current match assignment.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/public/:slug", async (req: Request, res: Response) => {
  try {
    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "WHERE s.slug = ?", [req.params.slug]);
    if (!slots.length) { res.status(404).json({ message: "Slot not found." }); return; }
    res.json({ slot: slots[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.use(Utils.ensureAuthenticated, requireCastOrAdmin);

/**
 * @swagger
 *
 * /obs-slots:
 *   get:
 *     description: List all OBS browser-source slots.
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: All configured slots.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "ORDER BY s.id ASC");
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots:
 *   post:
 *     description: Create a new OBS browser-source slot with a random slug.
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: The newly created slot.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const label = req.body?.label ? String(req.body.label).slice(0, 100) : null;
    const slug = await generateUniqueSlug();
    const insert: RowDataPacket[] = await db.query(
      "INSERT INTO obs_slot (user_id, label, slug) VALUES (?, ?, ?)",
      [req.user!.id, label, slug]
    );
    // @ts-ignore insertId from RowDataPacket
    const insertId = insert.insertId;
    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "WHERE s.id = ?", [insertId]);
    res.json({ slot: slots[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots/{id}:
 *   put:
 *     description: Rename a slot and/or reassign the match it currently points to.
 *     tags:
 *       - obs-slots
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: The updated slot.
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID." }); return; }
    const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE id = ?", [id]);
    if (!existing.length) { res.status(404).json({ message: "Slot not found." }); return; }

    const body = req.body ?? {};
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      updates.push("label = ?");
      params.push(body.label ? String(body.label).slice(0, 100) : null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "match_id")) {
      const matchId = body.match_id === null || body.match_id === "" ? null : parseInt(body.match_id);
      if (matchId !== null) {
        if (isNaN(matchId)) { res.status(400).json({ message: "Invalid match_id." }); return; }
        const matchRows: RowDataPacket[] = await db.query("SELECT id FROM `match` WHERE id = ?", [matchId]);
        if (!matchRows.length) { res.status(404).json({ message: "Match not found." }); return; }
      }
      updates.push("match_id = ?");
      params.push(matchId);
    }

    if (updates.length) {
      params.push(id);
      await db.query(`UPDATE obs_slot SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "WHERE s.id = ?", [id]);
    res.json({ slot: slots[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots/{id}:
 *   delete:
 *     description: Delete an OBS browser-source slot.
 *     tags:
 *       - obs-slots
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Deletion confirmation.
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID." }); return; }
    await db.query("DELETE FROM obs_slot WHERE id = ?", [id]);
    res.json({ message: "Slot deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;
