# Room and GRDB share migration versions for portable backups

Backups can move between iOS and Android, so GRDB migration identifiers use Android Room schema versions. iOS exports stamp SQLite `user_version` for Room, and iOS imports seed the GRDB ledger from an Android backup's schema version so only newer migrations run.

Restore removes unknown tables in one transaction and preserves shared tables, the Room and GRDB metadata tables, and SQLite's `sqlite_` tables. This keeps the migration ledgers available when the restored database opens.
