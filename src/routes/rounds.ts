/**
 * @swagger
 * resourcePath: /rounds
 * description: Express API router for round-by-round history of a map.
 */
import { Router } from "express";

const router = Router();

import { db } from "../services/db.js";

import { RowDataPacket } from "mysql2";

/**
 * @swagger
 *
 * /rounds/:map_id:
 *   get:
 *     description: Round-by-round history of a map (map_stats id) - winner,
 *       win reason, running score, sides and every kill of each round.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: map_id
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - rounds
 *     responses:
 *       200:
 *         description: List of rounds with their kills.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:map_id", async (req, res, next) => {
  try {
    const mapID: number = parseInt(req.params.map_id);
    const mapInfo: RowDataPacket[] = await db.query(
      `SELECT ms.id, m.team1_id, m.team2_id
      FROM map_stats ms JOIN \`match\` m ON m.id = ms.match_id
      WHERE ms.id = ?`,
      [mapID]
    );
    if (!mapInfo.length) {
      res.status(404).json({ message: "Map not found." });
      return;
    }
    const roundRows: RowDataPacket[] = await db.query(
      `SELECT round_number, winner_team, winner_side, reason, t1_score, t2_score, team1_side
      FROM map_round WHERE map_stats_id = ? ORDER BY round_number`,
      [mapID]
    );
    const killRows: RowDataPacket[] = await db.query(
      `SELECT round_number, round_time, attacker_steam_id, attacker_name, attacker_side,
        player_steam_id, player_name, player_side, weapon, headshot, friendly_fire, suicide
      FROM player_stat_extras WHERE map_id = ? ORDER BY id`,
      [mapID]
    );
    const rounds = roundRows.map((round) => ({
      round_num: round.round_number,
      winner_team_id:
        round.winner_team === "team1" ? mapInfo[0].team1_id
        : round.winner_team === "team2" ? mapInfo[0].team2_id
        : null,
      winner_side: round.winner_side,
      reason: round.reason,
      t1_score_after: round.t1_score,
      t2_score_after: round.t2_score,
      team1_side: round.team1_side,
      // Kill events carry a 0-based round_number while map_round is 1-based.
      kills: killRows
        .filter((k) => k.round_number + 1 === round.round_number)
        .map((k) => ({
          killer_steam_id: k.attacker_steam_id ?? null,
          killer_name: k.attacker_name ?? null,
          victim_steam_id: k.player_steam_id,
          victim_name: k.player_name,
          killer_side: k.attacker_side ? String(k.attacker_side).toUpperCase() : null,
          victim_side: String(k.player_side).toUpperCase(),
          weapon: k.weapon,
          round_time: k.round_time,
          headshot: !!k.headshot,
          friendly_fire: !!k.friendly_fire,
          suicide: !!k.suicide
        }))
    }));
    res.json(rounds);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;
