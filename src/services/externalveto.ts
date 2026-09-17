/**
 * Support for matches created with external_veto=1: the veto itself happens
 * outside of the assigned game server (e.g. a bot posting to /vetoes and
 * /vetosides with a user API key, or a separate MatchZy server loaded via
 * the match's own config endpoint), and the assigned server is only sent
 * its match config once that external veto is complete.
 */
import { db } from "./db.js";
import { RowDataPacket } from "mysql2";
import config from "config";
import GameServer from "../utility/serverrcon.js";

export interface PushMatchConfigResult {
  // False when the server itself wasn't alive/get5-available - the caller
  // treats this the same as "nothing to do yet", not a hard failure.
  attempted: boolean;
  // Only meaningful when attempted is true.
  success: boolean;
}

/**
 * Pushes a match's config to its assigned game server over RCON - the same
 * get5_web_available / get5_status / get5_loadmatch_url sequence used when a
 * classic (non-external-veto) match is created.
 * @param matchId - The match to load.
 * @param serverId - The game server to load it onto.
 * @param apiKey - The match's own API key (used by the server to fetch its config).
 */
export async function pushMatchConfigToServer(
  matchId: number,
  serverId: number,
  apiKey: string
): Promise<PushMatchConfigResult> {
  let sql: string =
    "SELECT rcon_password, ip_string, port FROM game_server WHERE id=?";
  const serveInfo: RowDataPacket[] = await db.query(sql, [serverId]);
  if (!serveInfo.length) return { attempted: false, success: false };
  const gameServer = new GameServer(
    serveInfo[0].ip_string,
    serveInfo[0].port,
    serveInfo[0].rcon_password
  );
  if (!((await gameServer.isServerAlive()) && (await gameServer.isGet5Available()))) {
    return { attempted: false, success: false };
  }
  sql = "UPDATE game_server SET in_use = 1 WHERE id = ?";
  await db.query(sql, [serverId]);

  sql = "UPDATE `match` SET plugin_version = ? WHERE id = ?";
  let get5Version: string = await gameServer.getGet5Version();
  await db.query(sql, [get5Version, matchId]);

  const success = await gameServer.prepareGet5Match(
    config.get("server.apiURL") + "/matches/" + matchId + "/config",
    apiKey
  );
  return { attempted: true, success };
}

/**
 * Checks whether an external-veto match's veto is complete (its picked map
 * count has reached max_maps) and, if so, builds the final maplist/map_sides
 * from the recorded veto/veto_side rows and pushes the config to the
 * assigned server. Safe to call after every pick - it no-ops until the veto
 * is actually finished, and again afterwards since map_sides is only ever
 * set once.
 * @param matchId - The match to check.
 */
export async function checkAndFinalizeExternalVeto(
  matchId: number | string
): Promise<void> {
  try {
    let sql: string =
      "SELECT external_veto, max_maps, server_id, api_key, map_sides, team1_id, team2_id " +
      "FROM `match` WHERE id = ?";
    const matchRows: RowDataPacket[] = await db.query(sql, [matchId]);
    if (!matchRows.length) return;
    const matchRow = matchRows[0];
    if (!matchRow.external_veto || matchRow.map_sides != null) return;
    if (!matchRow.server_id) return;

    sql =
      "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id ASC";
    const picks: RowDataPacket[] = await db.query(sql, [matchId]);
    if (picks.length < matchRow.max_maps) return;

    const maplist: string[] = picks.slice(0, matchRow.max_maps).map((p) => p.map);

    sql = "SELECT name FROM team WHERE id IN (?, ?)";
    const teamRows: RowDataPacket[] = await db.query(sql, [
      matchRow.team1_id,
      matchRow.team2_id
    ]);
    const team1Name = teamRows[0]?.name;

    sql = "SELECT map, side, team_name FROM veto_side WHERE match_id = ?";
    const sideRows: RowDataPacket[] = await db.query(sql, [matchId]);
    const sideByMap: Record<string, string> = {};
    sideRows.forEach((row) => {
      const pickingTeam = row.team_name === team1Name ? "team1" : "team2";
      sideByMap[row.map] = `${pickingTeam}_${row.side}`;
    });

    // The decider (last map in a Bo3/Bo5, the only map in a Bo1) is always a
    // knife round rather than a pre-decided side.
    const mapSides: string[] = maplist.map((mapName, index) => {
      if (index === maplist.length - 1) return "knife";
      return sideByMap[mapName] || "knife";
    });

    sql =
      "UPDATE `match` SET veto_mappool = ?, map_sides = ?, skip_veto = 1 WHERE id = ?";
    await db.query(sql, [maplist.join(" "), mapSides.join(","), matchId]);

    const result = await pushMatchConfigToServer(
      Number(matchId),
      matchRow.server_id,
      matchRow.api_key
    );
    if (!result.attempted || !result.success) {
      console.error(
        `[external-veto] Match ${matchId} finished its external veto but could not be loaded onto server ${matchRow.server_id}.`
      );
    }
  } catch (err) {
    console.error(
      `[external-veto] Error finalizing match ${matchId}: ` + (err as Error).toString()
    );
  }
}
