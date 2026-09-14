/** Service class for all map flow related logic during a live game.
 * @module routes/v2
 * @requires express
 * @requires db
 */
import { db } from "./db.js";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../utility/emitter.js";

/**
 * @const
 * Utility library to check API key validity.
 */
import Utils from "../utility/utils.js";
import { Get5_OnGoingLive } from "../types/map_flow/Get5_OnGoingLive.js";
import { Response } from "express";
import { RowDataPacket } from "mysql2";
import { Get5_OnMatchPausedUnpaused } from "../types/map_flow/Get5_OnMatchPausedUnpaused.js";
import { Get5_OnPlayerDeath } from "../types/map_flow/Get5_OnPlayerDeath.js";
import { Get5_OnBombEvent } from "../types/map_flow/Get5_OnBombEvent.js";
import { Get5_OnRoundEnd } from "../types/map_flow/Get5_OnRoundEnd.js";
import { Get5_OnRoundStart } from "../types/map_flow/Get5_OnRoundStart.js";

// Regulation length (MR12, 24 rounds) and rounds per overtime half (MR3) used
// to snapshot the regulation score and track per-OT score deltas in
// OnRoundEnd below.
export const REG_ROUNDS = 24;
export const OT_LEN = 6;

/**
 * @class
 * Map flow service class for live games.
 */
class MapFlowService {
  /**
   * Updates the database and emits mapStatUpdate when the map has gone live.
   * @param {Get5_OnGoingLive} event The OnGoingLive event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnGoingLive(
    event: Get5_OnGoingLive,
    res: Response
  ) {
    try {
      let sqlString: string;
      let mapStatInfo: RowDataPacket[];
      let vetoInfo: RowDataPacket[];
      let startTime: string = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      let insUpdStatement: object;
      let mapName: string;
      let matchInfo: RowDataPacket[];

      sqlString = "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id";
      vetoInfo = await db.query(sqlString, [event.matchid]);
      if (vetoInfo.length) {
        mapName = vetoInfo[event.map_number]?.map;
      } else {
        sqlString = "SELECT veto_mappool FROM `match` WHERE id = ?";
        matchInfo = await db.query(sqlString, [event.matchid]);
        mapName = matchInfo[0].veto_mappool.split(" ")[event.map_number];
      }
      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapStatInfo = await db.query(sqlString, [
        event.matchid,
        event.map_number
      ]);
      if (mapStatInfo.length) {
        insUpdStatement = {
          map_number: event.map_number,
          map_name: mapName
        };
        sqlString =
          "UPDATE map_stats SET ? WHERE match_id = ? AND map_number = ?";
        insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
        await db.query(sqlString, [insUpdStatement, event.matchid, event.map_number]);
      } else {
        insUpdStatement = {
          match_id: event.matchid,
          map_number: event.map_number,
          map_name: mapName,
          start_time: startTime,
          team1_score: 0,
          team2_score: 0
        };
        sqlString = "INSERT INTO map_stats SET ?";
        await db.query(sqlString, insUpdStatement);
        GlobalEmitter.emit("mapStatUpdate");
        return res.status(200).send({ message: "Success" });
      }
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a player has died.
   * @param {Get5_OnPlayerDeath} event The Get5_OnPlayerDeath event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnPlayerDeath(
    event: Get5_OnPlayerDeath,
    res: Response
  ) {
    try {
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      let sqlString: string;
      let mapInfo: RowDataPacket[];
      let insertObj: object;
      let playerTeamId: RowDataPacket[];
      let playerStatVals: RowDataPacket[];
      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapInfo = await db.query(sqlString, [event.matchid, event.map_number]);

      sqlString =
        "SELECT team_id FROM team_auth_names JOIN `match` m " +
        "ON (m.team1_id = team_id OR m.team2_id = team_id) WHERE m.id = ? AND auth = ?";
      playerTeamId = await db.query(sqlString, [event.matchid, event.player.steamid]);
      insertObj = {
        match_id: event.matchid,
        map_id: mapInfo[0].id,
        team_id: playerTeamId[0].team_id,
        player_steam_id: event.player.steamid,
        player_name: event.player.name,
        player_side: event.player.side,
        round_number: event.round_number,
        round_time: event.round_time,
        attacker_steam_id: event.attacker.steamid,
        attacker_name: event.attacker.name,
        attacker_side: event.attacker.side,
        weapon: event.weapon.name,
        bomb: event.bomb,
        headshot: event.headshot,
        thru_smoke: event.thru_smoke,
        penetrated: event.penetrated,
        attacker_blind: event.attacker_blind,
        no_scope: event.no_scope,
        suicide: event.suicide,
        friendly_fire: event.friendly_fire,
        assister_steam_id: event.assist?.player.steamid,
        assister_name: event.assist?.player.name,
        assister_side: event.assist?.player.side,
        assist_friendly_fire: event.assist?.friendly_fire,
        flash_assist: event.assist?.flash_assist
      };
      insertObj = await db.buildUpdateStatement(insertObj);
      sqlString = "INSERT INTO player_stat_extras SET ?";
      await db.query(sqlString, insertObj);

      GlobalEmitter.emit("playerStatsUpdate");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
      
    }
  }

  /**
   * Updates the database and emits bombEvent when a bomb has been planted or defused.
   * @param {Get5_OnBombEvent} event The Get5_OnBombEvent event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnBombEvent(
    event: Get5_OnBombEvent,
    res: Response,
    defused: boolean
  ) {
    try {
      let sqlString: string;
      let mapInfo: RowDataPacket[];
      let playerStatInfo: RowDataPacket[];
      let insObject: object;
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapInfo = await db.query(sqlString, [event.matchid, event.map_number]);
      sqlString =
        "SELECT id FROM player_stats WHERE match_id = ? AND map_id = ? AND steam_id = ?";
      playerStatInfo = await db.query(sqlString, [
        event.matchid,
        mapInfo[0].id,
        event.player.steamid
      ]);
      // If player does not have player stats yet, insert them.
      if (!playerStatInfo.length && !event.player?.is_bot) {
        let teamId: RowDataPacket[];
        sqlString =
          "SELECT t.id FROM team t JOIN team_auth_names ta ON ta.team_id = t.id WHERE ta.auth = ?";
        teamId = await db.query(sqlString, [event.player.steamid]);
        await Utils.updatePlayerStats(event.matchid, teamId[0].id, mapInfo[0].id, event.player, null);

        // Grab player info again!
        sqlString =
          "SELECT id FROM player_stats WHERE match_id = ? AND map_id = ? AND steam_id = ?";
        playerStatInfo = await db.query(sqlString, [
          event.matchid,
          mapInfo[0].id,
          event.player.steamid
        ]);
      }
      insObject = {
        match_id: event.matchid,
        map_id: mapInfo[0].id,
        player_stats_id: playerStatInfo[0].id,
        round_number: event.round_number,
        round_time: event.round_time,
        site: event.site,
        defused: defused,
        bomb_time_remaining: event?.bomb_time_remaining
      };

      insObject = await db.buildUpdateStatement(insObject);
      sqlString = "INSERT INTO match_bomb_plants SET ?";
      await db.query(sqlString, insObject);
      GlobalEmitter.emit("bombEvent");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a round has ended.
   * @param {Get5_OnRoundEnd} event The Get5_OnRoundEnd event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundEnd(
    event: Get5_OnRoundEnd,
    res: Response
  ) {
    try {
      // Query current map_stats INCLUDING scores BEFORE this round's update -
      // the pre-update scores are needed as the OT baseline below.
      let sqlString: string =
        "SELECT id, team1_score_ct, team1_score_t, team2_score_ct, team2_score_t, team1_first_side " +
        "FROM map_stats WHERE match_id = ? AND map_number = ?";
      let insUpdStatement: object;
      let mapStatInfo: RowDataPacket[];
      let playerStats: RowDataPacket[];
      let singlePlayerStat: RowDataPacket[];

      mapStatInfo = await db.query(sqlString, [
        event.matchid,
        event.map_number
      ]);
      sqlString =
        "SELECT * FROM player_stats WHERE match_id = ? AND map_id = ?";
      playerStats = await db.query(sqlString, [
        event.matchid,
        mapStatInfo[0]?.id
      ]);

      // team1_first_side is never sent to us directly - persist it the first
      // time we see this map's first round end, so later rounds/OTs (and the
      // fallback side computation below) have a real value instead of always
      // defaulting to "CT".
      let team1FirstSide: string | null = mapStatInfo[0]?.team1_first_side ?? null;
      if (!team1FirstSide && event.round_number === 1) {
        team1FirstSide = (event.team1.side ?? event.team1.starting_side ?? "CT").toUpperCase();
        await db.query(
          "UPDATE map_stats SET team1_first_side = ? WHERE id = ?",
          [team1FirstSide, mapStatInfo[0].id]
        );
      }
      for (let player of event.team1.players) {
        singlePlayerStat = playerStats.filter(
          (dbPlayer) => dbPlayer.steam_id == player.steamid
        );
        await Utils.updatePlayerStats(
          event.matchid,
          event.team1.id,
          mapStatInfo[0].id,
          player,
          singlePlayerStat[0]?.id
        );
      }
      for (let player of event.team2.players) {
        singlePlayerStat = playerStats.filter(
          (dbPlayer) => dbPlayer.steam_id == player.steamid
        );
        await Utils.updatePlayerStats(
          event.matchid,
          event.team2.id,
          mapStatInfo[0].id,
          player,
          singlePlayerStat[0]?.id
        );
      }
      GlobalEmitter.emit("playerStatsUpdate");

      // Regulation score snapshot (end of round 24).
      if (event.round_number === REG_ROUNDS) {
        await db.query(
          "UPDATE map_stats SET team1_reg_score_ct=?, team1_reg_score_t=?, team2_reg_score_ct=?, team2_reg_score_t=? WHERE id=?",
          [
            event.team1.score_ct, event.team1.score_t,
            event.team2.score_ct, event.team2.score_t,
            mapStatInfo[0].id
          ]
        );
      }

      // Overtime tracking: one map_stats_ot row per OT, storing the score
      // delta from that OT's start (the cumulative score at OT start is kept
      // as the offset_* baseline).
      if (event.round_number > REG_ROUNDS) {
        const otNum = Math.ceil((event.round_number - REG_ROUNDS) / OT_LEN);
        const isFirstOtRound = (event.round_number - REG_ROUNDS - 1) % OT_LEN === 0;

        if (isFirstOtRound) {
          await db.query(
            `INSERT INTO map_stats_ot
               (map_stats_id, ot_number, team1_first_side,
                team1_score_ct, team1_score_t, team2_score_ct, team2_score_t,
                offset_t1_ct, offset_t1_t, offset_t2_ct, offset_t2_t)
             VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE team1_first_side = VALUES(team1_first_side)`,
            [
              mapStatInfo[0].id, otNum,
              // The side the team is actually on when this OT starts, not
              // the side it started the whole map with.
              event.team1.side?.toUpperCase() ?? null,
              mapStatInfo[0].team1_score_ct, mapStatInfo[0].team1_score_t,
              mapStatInfo[0].team2_score_ct, mapStatInfo[0].team2_score_t
            ]
          );
        }

        const otRow: RowDataPacket[] = await db.query(
          "SELECT offset_t1_ct, offset_t1_t, offset_t2_ct, offset_t2_t FROM map_stats_ot WHERE map_stats_id = ? AND ot_number = ?",
          [mapStatInfo[0].id, otNum]
        );
        if (otRow.length) {
          await db.query(
            `UPDATE map_stats_ot SET team1_score_ct=?, team1_score_t=?, team2_score_ct=?, team2_score_t=?
             WHERE map_stats_id=? AND ot_number=?`,
            [
              event.team1.score_ct - otRow[0].offset_t1_ct,
              event.team1.score_t  - otRow[0].offset_t1_t,
              event.team2.score_ct - otRow[0].offset_t2_ct,
              event.team2.score_t  - otRow[0].offset_t2_t,
              mapStatInfo[0].id, otNum
            ]
          );
        }
      }

      // Round history: one map_round row per round, with winner/side/reason
      // normalized to human-readable values.
      if (event.winner?.team && event.winner?.side) {
        // Matchzy may send a raw CsTeam int ("2"=T, "3"=CT) for winner.side
        // depending on plugin version - normalize either form to CT/T.
        const rawSide = String(event.winner.side);
        const winnerSide = rawSide === "3" ? "CT"
                         : rawSide === "2" ? "T"
                         : rawSide.toUpperCase() === "COUNTERTERRORIST" ? "CT"
                         : rawSide.toUpperCase() === "TERRORIST" ? "T"
                         : rawSide;

        // Translate the CS2 RoundEndReason enum (CounterStrikeSharp) to a
        // human-readable string for storage/display.
        const ROUND_END_REASONS: Record<number, string> = {
          0:  "unknown",
          1:  "target_bombed",
          4:  "terrorists_escaped",
          5:  "cts_prevent_escape",
          6:  "terrorists_neutralized",
          7:  "bomb_defused",
          8:  "ct_win",
          9:  "t_win",
          10: "draw",
          11: "hostages_rescued",
          12: "target_saved",
          13: "hostages_not_rescued",
          14: "terrorists_not_escaped",
          16: "game_commencing",
          17: "t_surrender",
          18: "ct_surrender",
          19: "t_planted",
          20: "cts_reached_hostage",
          21: "survival_win",
          22: "survival_draw",
        };
        const reasonStr = ROUND_END_REASONS[event.reason] ?? String(event.reason);

        // team1_side: prefer the value sent by Matchzy, falling back to a
        // computation from team1_first_side + round_number (with an OT
        // half-swap) if starting_side wasn't sent.
        let team1Side: string | null = event.team1.starting_side ?? null;
        if (!team1Side) {
          const firstSide = (team1FirstSide ?? "CT").toUpperCase();
          const rn = event.round_number;
          if (rn <= 12) {
            team1Side = firstSide;
          } else if (rn <= 24) {
            team1Side = firstSide === "CT" ? "T" : "CT";
          } else {
            const otHalf = Math.floor((rn - 25) / 3) % 2;
            const otStart = firstSide === "CT" ? "T" : "CT";
            team1Side = otHalf === 0 ? otStart : (otStart === "CT" ? "T" : "CT");
          }
        }

        await db.query(
          `INSERT INTO map_round
             (map_stats_id, round_number, winner_team, winner_side, reason, t1_score, t2_score, team1_side)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             winner_team = VALUES(winner_team),
             winner_side = VALUES(winner_side),
             reason      = VALUES(reason),
             t1_score    = VALUES(t1_score),
             t2_score    = VALUES(t2_score),
             team1_side  = VALUES(team1_side)`,
          [
            mapStatInfo[0].id,
            event.round_number,
            event.winner.team,
            winnerSide,
            reasonStr,
            event.team1.score,
            event.team2.score,
            team1Side
          ]
        );
      }

      // Update map stats.
      sqlString = "UPDATE map_stats SET ? WHERE id = ?";
      insUpdStatement = {
        team1_score: event.team1.score,
        team1_score_ct: event.team1.score_ct,
        team1_score_t: event.team1.score_t,
        team2_score: event.team2.score,
        team2_score_ct: event.team2.score_ct,
        team2_score_t: event.team2.score_t
      }
      await db.query(sqlString, [insUpdStatement, mapStatInfo[0].id]);
      GlobalEmitter.emit("mapStatUpdate");

      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  

  /**
   * Updates the database and emits playerStatsUpdate when a round has been restored and the match has started again.
   * @param {Get5_OnRoundStart} event The Get5_OnRoundStart event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundStart(
    event: Get5_OnRoundStart,
    res: Response
  ) {
    let sqlString: string;
    let mapStatInfo: RowDataPacket[];
    // Check if round was backed up and nuke the additional player stats and bomb plants.
    sqlString = "SELECT round_restored, id FROM map_stats WHERE match_id = ? AND map_number = ?";
    mapStatInfo = await db.query(sqlString, [event.matchid, event.map_number]);
    if (mapStatInfo[0]?.round_restored) {
      sqlString =
        "DELETE FROM match_bomb_plants WHERE round_number > ? AND match_id = ? AND map_id = ?";
      await db.query(sqlString, [
        event.round_number,
        event.matchid,
        mapStatInfo[0].id
      ]);

      sqlString =
        "DELETE FROM player_stat_extras WHERE match_id = ? AND map_id = ? AND round_number > ?";
      await db.query(sqlString, [
        event.matchid,
        mapStatInfo[0].id,
        event.round_number
      ]);
      // Only emit if there was an actual update.
      GlobalEmitter.emit("playerStatsUpdate");
    }
    return res.status(200).send({ message: "Success" });
  }

  /**
   * Updates the database and emits matchUpdate when a match has been paused or unpaused.
   * @param {Get5_OnMatchPausedUnpaused} event The Get5_OnMatchPausedUnpaused event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnMatchPausedUnPaused(
    event: Get5_OnMatchPausedUnpaused,
    res: Response
  ) {
    let sqlString: string;
    let matchInfo: RowDataPacket[];
    let pauseInfo: RowDataPacket[];
    let insUpdStatement: object;
    let teamPaused: string;

    sqlString = "SELECT team1_string, team2_string FROM `match` WHERE id = ?";
    matchInfo = await db.query(sqlString, [event.matchid]);

    sqlString = "SELECT * FROM match_pause WHERE match_id = ?";
    pauseInfo = await db.query(sqlString, [event.matchid]);

    if (event.team == "team1") teamPaused = matchInfo[0].team1_string;
    else if (event.team == "team2") teamPaused = matchInfo[0].team1_string;
    else teamPaused = "Admin";

    if (pauseInfo.length) {
      sqlString = "UPDATE match_pause SET ? WHERE match_id = ?";
      insUpdStatement = {
        pause_type: event.pause_type,
        team_paused: teamPaused,
        paused: event.event == "game_paused" ? true : false
      };
      insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
      await db.query(sqlString, [insUpdStatement, event.matchid]);
    } else {
      sqlString = "INSERT INTO match_pause SET ?";
      insUpdStatement = {
        match_id: event.matchid,
        pause_type: event.pause_type,
        team_paused: teamPaused,
        paused: event.event == "game_paused" ? true : false
      };
      insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
      await db.query(sqlString, insUpdStatement);
    }
    GlobalEmitter.emit("matchUpdate");
    return res.status(200).send({ message: "Success" });
  }
}

export default MapFlowService;
