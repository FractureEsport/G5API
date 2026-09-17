"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

// A match created with external_veto=1 is not pushed to its assigned game
// server right away - the veto happens elsewhere (a bot/tool posting to
// /vetoes and /vetosides using a user API key) and the server is only
// loaded once that veto is complete (see matches.ts finalizeExternalVeto).
exports.up = function (db) {
  return db.runSql(
    `ALTER TABLE \`match\`
      ADD COLUMN external_veto BOOLEAN NOT NULL DEFAULT FALSE AFTER skip_veto;`
  );
};

exports.down = function (db) {
  return db.runSql(`ALTER TABLE \`match\` DROP COLUMN external_veto;`);
};

exports._meta = {
  version: 1,
};
