"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

// MatchZy sends a `penetrated` (wallbang) flag on every player_death event
// (see MatchZy's Events.cs `MatchZyPlayerDeathEvent.Penetrated`) that was
// never persisted - neither here nor in French-CSGO. Bonus addition, not a
// parity gap.
exports.up = function (db) {
  return db.runSql(
    "ALTER TABLE player_stat_extras ADD COLUMN penetrated TINYINT(1) NOT NULL DEFAULT 0 AFTER thru_smoke;"
  );
};

exports.down = function (db) {
  return db.runSql(
    "ALTER TABLE player_stat_extras DROP COLUMN penetrated;"
  );
};

exports._meta = {
  version: 1,
};
