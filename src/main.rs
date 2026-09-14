#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use chrono::{DateTime, Utc};
use directories_next::{BaseDirs, ProjectDirs};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use slint::{ComponentHandle, Timer, TimerMode};
use std::{
    fs,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
slint::include_modules!();
#[derive(Clone, Default, Serialize, Deserialize)]
struct Settings {
    api_url: String,
    api_token: String,
    project: String,
    activity: String,
    project_id: i64,
    activity_id: i64,
    week_hours: f64,
    state: String,
    work_days: Vec<String>,
    work_start: String,
}
fn path() -> std::path::PathBuf {
    ProjectDirs::from("org", "kimaier", "Kimaier")
        .unwrap()
        .config_dir()
        .join("settings.json")
}
fn load() -> Settings {
    let data = fs::read(path()).ok().or_else(|| {
        BaseDirs::new().and_then(|d| fs::read(d.data_local_dir().join("kimaier/kimaier.dat")).ok())
    });
    let Some(data) = data else {
        return Settings::default();
    };
    let Ok(mut value) = serde_json::from_slice::<Value>(&data) else {
        return Settings::default();
    };
    value = value.get("user").cloned().unwrap_or(value);
    if value
        .get("api_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .is_empty()
    {
        if let Some(token) = value.get("api_pass").cloned() {
            value["api_token"] = token;
        }
    }
    if let Some(object) = value.as_object_mut() {
        object.remove("api_pass");
    }
    serde_json::from_value(value).unwrap_or_default()
}
fn save(s: &Settings) -> Result<(), String> {
    let p = path();
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(p, serde_json::to_vec(s).unwrap()).map_err(|e| e.to_string())
}
fn api(s: &Settings, method: reqwest::Method, endpoint: &str) -> Result<Value, String> {
    let r = reqwest::blocking::Client::new()
        .request(
            method,
            format!("{}{}", s.api_url.trim_end_matches('/'), endpoint),
        )
        .bearer_auth(&s.api_token)
        .send()
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("Kimai returned {}", r.status()));
    };
    r.json().map_err(|e| e.to_string())
}
fn active_started(s: &Settings) -> Result<Option<DateTime<Utc>>, String> {
    let value = api(s, reqwest::Method::GET, "/api/timesheets/active")?;
    value
        .as_array()
        .and_then(|items| items.first())
        .map(|entry| {
            entry
                .get("begin")
                .and_then(Value::as_str)
                .ok_or_else(|| "Active entry has no begin time".to_string())?
                .parse::<DateTime<Utc>>()
                .map_err(|e| e.to_string())
        })
        .transpose()
}
fn refresh_active(
    s: Settings,
    started: Arc<Mutex<Option<DateTime<Utc>>>>,
    weak: slint::Weak<MainWindow>,
) {
    thread::spawn(move || {
        let result = active_started(&s);
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(w) = weak.upgrade() {
                match result {
                    Ok(begin) => {
                        *started.lock().unwrap() = begin;
                        w.set_running(begin.is_some());
                        w.set_status("".into());
                    }
                    Err(error) => w.set_status(error.into()),
                }
            }
        });
    });
}
fn main() -> Result<(), slint::PlatformError> {
    let w = MainWindow::new()?;
    let state = Arc::new(Mutex::new(load()));
    let started = Arc::new(Mutex::new(None));
    {
        let s = state.lock().unwrap();
        w.set_api_url(s.api_url.clone().into());
        w.set_api_token(s.api_token.clone().into());
        w.set_project(s.project.clone().into());
        w.set_activity(s.activity.clone().into());
        w.set_week_hours(s.week_hours.to_string().into());
        w.set_work_start(s.work_start.clone().into());
        let has = |day: &str| s.work_days.iter().any(|value| value == day);
        w.set_monday(has("Mo"));
        w.set_tuesday(has("Tu"));
        w.set_wednesday(has("We"));
        w.set_thursday(has("Th"));
        w.set_friday(has("Fr"));
        w.set_saturday(has("Sa"));
        w.set_sunday(has("Su"));
        if s.activity_id == 0 {
            w.set_page(1)
        }
    }
    let weak = w.as_weak();
    let st = state.clone();
    w.on_save(move || {
        let Some(w) = weak.upgrade() else { return };
        let mut work_days = Vec::new();
        for (enabled, day) in [
            (w.get_monday(), "Mo"),
            (w.get_tuesday(), "Tu"),
            (w.get_wednesday(), "We"),
            (w.get_thursday(), "Th"),
            (w.get_friday(), "Fr"),
            (w.get_saturday(), "Sa"),
            (w.get_sunday(), "Su"),
        ] {
            if enabled {
                work_days.push(day.into());
            }
        }
        let previous = st.lock().unwrap().clone();
        let mut s = Settings {
            api_url: w.get_api_url().trim_end_matches('/').into(),
            api_token: w.get_api_token().into(),
            project: w.get_project().into(),
            activity: w.get_activity().into(),
            week_hours: w.get_week_hours().parse().unwrap_or_default(),
            work_start: w.get_work_start().into(),
            work_days,
            state: previous.state,
            ..Default::default()
        };
        let weak = w.as_weak();
        let st = st.clone();
        thread::spawn(move || {
            let result = api(&s, reqwest::Method::GET, "/api/activities").and_then(|v| {
                let found = v
                    .as_array()
                    .and_then(|a| {
                        a.iter().find(|x| {
                            x["parentTitle"]
                                .as_str()
                                .map(|t| t.eq_ignore_ascii_case(&s.project))
                                .unwrap_or(false)
                                && x["name"]
                                    .as_str()
                                    .map(|t| t.eq_ignore_ascii_case(&s.activity))
                                    .unwrap_or(false)
                        })
                    })
                    .ok_or("Project/activity not found")?;
                s.project_id = found["project"].as_i64().ok_or("No project id")?;
                s.activity_id = found["id"].as_i64().ok_or("No activity id")?;
                save(&s)
            });
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(w) = weak.upgrade() {
                    match result {
                        Ok(()) => {
                            *st.lock().unwrap() = s;
                            w.set_page(0);
                            w.set_status("Saved.".into())
                        }
                        Err(e) => w.set_status(e.into()),
                    }
                }
            });
        });
    });
    let weak = w.as_weak();
    let st = state.clone();
    let toggle_started = started.clone();
    w.on_toggle(move || {
        let s = st.lock().unwrap().clone(); let weak = weak.clone(); let started = toggle_started.clone();
        thread::spawn(move || {
            let result = api(&s, reqwest::Method::GET, "/api/timesheets/active").and_then(|v| {
                if let Some(e) = v.as_array().and_then(|a| a.first()) {
                    api(&s, reqwest::Method::PATCH, &format!("/api/timesheets/{}/stop", e["id"].as_i64().ok_or("No id")?)).map(|_| None)
                } else {
                    let begin = Utc::now();
                    let r = reqwest::blocking::Client::new().post(format!("{}/api/timesheets", s.api_url)).bearer_auth(&s.api_token)
                        .json(&json!({"begin":begin.to_rfc3339(),"project":s.project_id,"activity":s.activity_id})).send().map_err(|e|e.to_string())?;
                    if r.status().is_success() { Ok(Some(begin)) } else { Err(format!("Kimai returned {}",r.status())) }
                }
            });
            let _ = slint::invoke_from_event_loop(move || if let Some(w)=weak.upgrade() { match result {
                Ok(begin) => { *started.lock().unwrap() = begin; w.set_running(begin.is_some()); w.set_elapsed("00:00:00".into()); w.set_status("".into()); },
                Err(e) => w.set_status(e.into()),
            }});
        });
    });
    let weak = w.as_weak();
    w.on_show(move |p| {
        if let Some(w) = weak.upgrade() {
            w.set_page(p)
        }
    });
    let weak = w.as_weak();
    w.on_check_update(move || {
        if let Some(window) = weak.upgrade() {
            window.set_status("Checking for updates…".into());
            let weak = window.as_weak();
            thread::spawn(move || {
                let result = self_update::backends::github::Update::configure()
                    .repo_owner("jb-alvarado")
                    .repo_name("kimaier")
                    .bin_name("kimaier")
                    .current_version(env!("CARGO_PKG_VERSION"))
                    .show_download_progress(false)
                    .show_output(false)
                    .no_confirm(true)
                    .build()
                    .and_then(|u| u.update())
                    .map(|s| s.version().to_string())
                    .map_err(|e| e.to_string());
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(window) = weak.upgrade() {
                        window.set_status(
                            match result {
                                Ok(version) => format!("Updated to {version}. Restart Kimaier."),
                                Err(error) => format!("Update failed: {error}"),
                            }
                            .into(),
                        );
                    }
                });
            });
        }
    });
    refresh_active(state.lock().unwrap().clone(), started.clone(), w.as_weak());
    let timer = Timer::default();
    let weak = w.as_weak();
    let timer_started = started.clone();
    let timer_state = state.clone();
    let ticks = Arc::new(Mutex::new(0_u8));
    let timer_ticks = ticks.clone();
    timer.start(TimerMode::Repeated, Duration::from_secs(1), move || {
        if let Some(w) = weak.upgrade() {
            if let Some(begin) = *timer_started.lock().unwrap() {
                let n = (Utc::now() - begin).num_seconds().max(0);
                w.set_elapsed(format!("{:02}:{:02}:{:02}", n / 3600, n / 60 % 60, n % 60).into());
            }
            let mut ticks = timer_ticks.lock().unwrap();
            *ticks += 1;
            if *ticks >= 60 {
                *ticks = 0;
                refresh_active(
                    timer_state.lock().unwrap().clone(),
                    timer_started.clone(),
                    w.as_weak(),
                );
            }
        }
    });
    w.run()
}
