use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedHistory {
    covered_until: String,
    total_seconds: i64,
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    open_database(&directory.join("timesheets.sqlite"))
}

fn open_database(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
            scope TEXT PRIMARY KEY,
            covered_until TEXT NOT NULL,
            total_seconds INTEGER NOT NULL CHECK (total_seconds >= 0)
        );",
        )
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

#[tauri::command]
pub fn read_timesheet_cache(
    app: tauri::AppHandle,
    scope: String,
) -> Result<Option<CachedHistory>, String> {
    read(&open(&app)?, &scope)
}

fn read(connection: &Connection, scope: &str) -> Result<Option<CachedHistory>, String> {
    connection
        .query_row(
            "SELECT covered_until, total_seconds FROM history WHERE scope = ?1",
            [scope],
            |row| {
                Ok(CachedHistory {
                    covered_until: row.get(0)?,
                    total_seconds: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_timesheet_cache(
    app: tauri::AppHandle,
    scope: String,
    history: CachedHistory,
) -> Result<(), String> {
    write(&open(&app)?, &scope, &history)
}

fn write(connection: &Connection, scope: &str, history: &CachedHistory) -> Result<(), String> {
    // One atomic statement: a failed refresh leaves the previous snapshot intact.
    connection
        .execute(
            "INSERT INTO history (scope, covered_until, total_seconds) VALUES (?1, ?2, ?3)
         ON CONFLICT(scope) DO UPDATE SET covered_until = excluded.covered_until,
                                         total_seconds = excluded.total_seconds",
            params![scope, history.covered_until, history.total_seconds],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_persist_are_isolated_and_replace_atomically() {
        let path = std::env::temp_dir().join(format!(
            "kimaier-cache-test-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        {
            let connection = open_database(&path).unwrap();
            assert!(read(&connection, "user-a").unwrap().is_none());
            write(
                &connection,
                "user-a",
                &CachedHistory {
                    covered_until: "2026-11-01T00:00:00".into(),
                    total_seconds: 3600,
                },
            )
            .unwrap();
        }
        {
            let connection = open_database(&path).unwrap();
            assert_eq!(
                read(&connection, "user-a").unwrap().unwrap().total_seconds,
                3600
            );
            assert!(read(&connection, "user-b").unwrap().is_none());
            assert!(
                write(
                    &connection,
                    "user-a",
                    &CachedHistory {
                        covered_until: "2026-12-01T00:00:00".into(),
                        total_seconds: -1,
                    }
                )
                .is_err()
            );
            let old = read(&connection, "user-a").unwrap().unwrap();
            assert_eq!(old.total_seconds, 3600);
            assert_eq!(old.covered_until, "2026-11-01T00:00:00");
            write(
                &connection,
                "user-a",
                &CachedHistory {
                    covered_until: "2026-12-01T00:00:00".into(),
                    total_seconds: 0,
                },
            )
            .unwrap();
            assert_eq!(
                read(&connection, "user-a").unwrap().unwrap().total_seconds,
                0
            );
        }
        std::fs::remove_file(path).unwrap();
    }
}
