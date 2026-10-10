use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

pub struct Store {
    pub conn: Connection,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub content: Option<String>,
    pub revision: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    id: i64,
    created_at: String,
    reason: String,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )
        .map_err(|e| e.to_string())?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err("This database was created by a newer application. Update caLEANdar before opening it.".into());
        }
        if version == 0 {
            conn.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL CHECK(json_valid(content)), revision INTEGER NOT NULL);
                CREATE TABLE backups (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), reason TEXT NOT NULL, content TEXT NOT NULL CHECK(json_valid(content)));
                PRAGMA user_version=1; COMMIT;").map_err(|e| e.to_string())?;
        }
        Ok(Self { conn })
    }
    pub fn load(&self) -> Result<Snapshot, String> {
        self.conn
            .query_row("SELECT content, revision FROM state WHERE id=1", [], |r| {
                Ok(Snapshot {
                    content: Some(r.get(0)?),
                    revision: r.get(1)?,
                })
            })
            .optional()
            .map(|s| {
                s.unwrap_or(Snapshot {
                    content: None,
                    revision: 0,
                })
            })
            .map_err(|e| e.to_string())
    }
    pub fn save(
        &mut self,
        content: &str,
        expected_revision: i64,
        reason: &str,
    ) -> Result<i64, String> {
        if content.len() > 40_000_000 {
            return Err("The calendar exceeds the 40 MB storage limit.".into());
        }
        let doc: serde_json::Value =
            serde_json::from_str(content).map_err(|e| format!("Invalid JSON: {e}"))?;
        if doc.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1) {
            return Err("Unsupported configuration version.".into());
        }
        for key in ["sources", "courses", "sessions", "extras", "academics"] {
            if !doc.get(key).is_some_and(|v| v.is_array()) {
                return Err(format!("Missing or invalid {key}."));
            }
        }
        if !doc.get("settings").is_some_and(|v| v.is_object())
            || !doc.get("exceptions").is_some_and(|v| v.is_object())
        {
            return Err("Missing settings or exceptions.".into());
        }
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let previous: Option<(String, i64)> = tx
            .query_row("SELECT content, revision FROM state WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let actual_revision = previous.as_ref().map_or(0, |p| p.1);
        if actual_revision != expected_revision {
            return Err(
                "The calendar changed in another application window. Reload before saving.".into(),
            );
        }
        if let Some((old, _)) = previous {
            tx.execute(
                "INSERT INTO backups(reason,content) VALUES (?1,?2)",
                params![reason, old],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 50)", []).map_err(|e| e.to_string())?;
        }
        let revision = actual_revision + 1;
        tx.execute("INSERT INTO state(id,content,revision) VALUES (1,?1,?2) ON CONFLICT(id) DO UPDATE SET content=excluded.content, revision=excluded.revision", params![content, revision]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(revision)
    }
    pub fn backups(&self) -> Result<Vec<Backup>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT id,created_at,reason FROM backups ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok(Backup {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    reason: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn backup_content(&self, id: i64) -> Result<String, String> {
        self.conn
            .query_row("SELECT content FROM backups WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| {
                "This backup is no longer available. Reopen Recovery to refresh the list."
                    .to_string()
            })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn state(name: &str) -> String {
        serde_json::json!({"schemaVersion":1,"sources":[],"courses":[{"name":name}],"sessions":[],"extras":[],"academics":[],"exceptions":{},"settings":{}}).to_string()
    }
    #[test]
    fn persistence_migration_transaction_backup_and_revision() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("calendar.sqlite");
        let mut store = Store::open(&path).unwrap();
        assert_eq!(store.load().unwrap().revision, 0);
        store.save(&state("original"), 0, "Initial").unwrap();
        store
            .save(&state("edited"), 1, "Replace configuration")
            .unwrap();
        assert!(store.save("broken", 2, "Bad import").is_err());
        assert!(store.save(&state("stale"), 1, "Concurrent edit").is_err());
        let backups = store.backups().unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            store.backup_content(backups[0].id).unwrap(),
            state("original")
        );
        drop(store);
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.load().unwrap().content.unwrap(), state("edited"));
        assert_eq!(
            reopened
                .conn
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
