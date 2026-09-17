/**
 * Centralized map identifier <-> display name resolution, and season-scoped map pool
 * helpers. A map's technical id (e.g. `de_mirage`, or a bare Steam Workshop file id
 * such as `3081538` - the only workshop format CS2/MatchZy recognizes, see
 * MatchZy's HandleMapChangeCommand) is what's stored in the DB and sent to MatchZy.
 * The display name returned here is for UI purposes only and must never be sent back
 * to MatchZy or stored as if it were the technical id.
 */
import config from "config";
import { db } from "../services/db.js";
import { RowDataPacket } from "mysql2";

export interface KnownMap {
  map_name: string;
  map_display_name: string;
}

/** A bare Steam Workshop file id is the only workshop map format CS2/MatchZy accepts. */
export function isWorkshopMapId(mapId: string): boolean {
  return /^\d+$/.test((mapId ?? "").trim());
}

function prettifyMapId(mapId: string): string {
  if (isWorkshopMapId(mapId)) return `Workshop #${mapId}`;
  if (!mapId.includes("_")) return mapId;
  return mapId
    .replace(/^(de|cs|aim|gg|surf|wm)_/i, "")
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Resolves a map's technical id to a human-readable display name. `extraNames` lets
 * callers layer season/match-specific overrides (e.g. a custom name for a workshop
 * map) on top of the global default map catalog. Falls back to a prettified id -
 * never an error - when no known name exists, per spec.
 */
export function getMapDisplayName(
  mapId: string,
  extraNames?: Record<string, string> | null
): string {
  if (!mapId) return mapId;
  if (extraNames && extraNames[mapId]) return extraNames[mapId];
  const knownMaps = config.get("defaultMaps") as KnownMap[];
  const known = knownMaps.find(m => m.map_name === mapId);
  if (known) return known.map_display_name;
  return prettifyMapId(mapId);
}

/**
 * Returns the season's configured map pool (technical map ids), or null when the
 * season has no `map_pool` cvar configured. This is the sole source of truth for
 * "which maps are available" when a match belongs to a season - a user's personal
 * `map_list` must never be consulted for this.
 */
export async function getSeasonMapPool(
  seasonId: number | null | undefined
): Promise<string[] | null> {
  if (!seasonId) return null;
  const rows: RowDataPacket[] = await db.query(
    "SELECT cvar_value FROM season_cvar WHERE season_id = ? AND cvar_name = 'map_pool'",
    [seasonId]
  );
  if (!rows.length || !rows[0].cvar_value) return null;
  const pool = String(rows[0].cvar_value).trim().split(/\s+/).filter(Boolean);
  return pool.length ? pool : null;
}

/**
 * Returns the season's optional per-map display-name overrides (technical id ->
 * display name), stored as a JSON object in the `map_pool_names` cvar. Used for maps
 * (typically workshop maps) that aren't in the global default map catalog. Never
 * throws on missing/malformed data - returns {} instead.
 */
export async function getSeasonMapNames(
  seasonId: number | null | undefined
): Promise<Record<string, string>> {
  if (!seasonId) return {};
  const rows: RowDataPacket[] = await db.query(
    "SELECT cvar_value FROM season_cvar WHERE season_id = ? AND cvar_name = 'map_pool_names'",
    [seasonId]
  );
  if (!rows.length || !rows[0].cvar_value) return {};
  try {
    const parsed = JSON.parse(rows[0].cvar_value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Validates that every submitted map id belongs to the season's configured map pool.
 * Returns null when valid (including when the season has no configured pool - nothing
 * to enforce), or an error message naming the first invalid map otherwise.
 */
export async function validateMapsAgainstSeason(
  seasonId: number | null | undefined,
  submittedMaps: string[]
): Promise<string | null> {
  const pool = await getSeasonMapPool(seasonId);
  if (!pool) return null;
  for (const map of submittedMaps) {
    if (!pool.includes(map)) {
      return `Map "${map}" is not part of the season's map pool.`;
    }
  }
  return null;
}
