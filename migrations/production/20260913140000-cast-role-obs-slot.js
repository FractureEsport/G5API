"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

// Cast/broadcaster support: a `cast` role on users (separate from admin),
// an optional alternate/public IP for casters and GOTV viewers to connect
// to instead of the real server IP, and a table of stable, reassignable
// "OBS slot" links a caster can repoint between matches without touching
// their OBS scene.
exports.up = function (db) {
  return db
    .runSql(
      `ALTER TABLE user ADD COLUMN IF NOT EXISTS cast TINYINT(1) NOT NULL DEFAULT 0`
    )
    .then(() =>
      db.runSql(
        `ALTER TABLE game_server ADD COLUMN IF NOT EXISTS ip_cast VARCHAR(45) NULL DEFAULT NULL`
      )
    )
    .then(() =>
      db.runSql(`
        CREATE TABLE IF NOT EXISTS obs_slot (
          id         INT NOT NULL AUTO_INCREMENT,
          user_id    INT NOT NULL,
          label      VARCHAR(100) DEFAULT NULL,
          slug       VARCHAR(32) NOT NULL,
          match_id   INT DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_obs_slot_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `)
    );
};

exports.down = function (db) {
  return db
    .runSql("DROP TABLE IF EXISTS obs_slot;")
    .then(() => db.runSql("ALTER TABLE game_server DROP COLUMN ip_cast;"))
    .then(() => db.runSql("ALTER TABLE user DROP COLUMN cast;"));
};

exports._meta = {
  version: 1,
};
