use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use bytes::Bytes;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{error, info};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    storage_dir: PathBuf,
    anthropic_key: String,
    anthropic_model: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    model: String,
}

#[derive(Serialize)]
struct EntrySummary {
    id: Uuid,
    created_at: DateTime<Utc>,
    image_url: String,
    label: String,
    description: String,
    confidence: Option<f64>,
    tags: Vec<String>,
    shared: bool,
}

#[derive(Serialize)]
struct EntryDetail {
    id: Uuid,
    created_at: DateTime<Utc>,
    image_url: String,
    label: String,
    description: String,
    confidence: Option<f64>,
    tags: Vec<String>,
    shared: bool,
    share_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SettingsPayload {
    is_public: bool,
}

#[derive(Serialize, Deserialize)]
struct SharePayload {
    enable: bool,
}

#[derive(Serialize, Deserialize)]
struct Classification {
    label: String,
    description: String,
    tags: Vec<String>,
    confidence: Option<f64>,
}

#[derive(Serialize)]
struct CreateEntryResponse {
    entry: EntryDetail,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");
    let anthropic_key = std::env::var("ANTHROPIC_API_KEY")
        .expect("ANTHROPIC_API_KEY must be set");
    let anthropic_model = std::env::var("ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-opus-4-5".to_string());
    let storage_dir = PathBuf::from(
        std::env::var("STORAGE_DIR").unwrap_or_else(|_| "storage".to_string()),
    );
    let images_dir = storage_dir.join("images");
    std::fs::create_dir_all(&images_dir)?;

    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;
    ensure_settings(&db).await?;

    let state = Arc::new(AppState {
        db,
        storage_dir,
        anthropic_key,
        anthropic_model,
    });

    spawn_cleanup(state.clone());

    let api = Router::new()
        .route("/health", get(health))
        .route("/settings", get(get_settings).put(update_settings))
        .route("/entries", get(list_entries).post(create_entry))
        .route("/entries/:id", get(get_entry))
        .route("/entries/:id/delete", post(soft_delete_entry))
        .route("/entries/:id/restore", post(restore_entry))
        .route("/entries/:id/share", post(toggle_share))
        .route("/share/:token", get(get_shared_entry))
        .route("/public/entries", get(list_public_entries))
        .with_state(state.clone());

    let app = Router::new()
        .nest("/api", api)
        .nest_service("/media", ServeDir::new(state.storage_dir.clone()))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024));

    let addr: SocketAddr = "0.0.0.0:4000".parse()?;
    info!("listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        model: state.anthropic_model.clone(),
    })
}

async fn get_settings(State(state): State<Arc<AppState>>) -> Result<Json<SettingsPayload>, AppError> {
    let row = sqlx::query("SELECT is_public FROM settings WHERE id = 1")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(SettingsPayload {
        is_public: row.get("is_public"),
    }))
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SettingsPayload>,
) -> Result<Json<SettingsPayload>, AppError> {
    sqlx::query("UPDATE settings SET is_public = $1, updated_at = NOW() WHERE id = 1")
        .bind(payload.is_public)
        .execute(&state.db)
        .await?;

    Ok(Json(payload))
}

async fn list_entries(State(state): State<Arc<AppState>>) -> Result<Json<Vec<EntrySummary>>, AppError> {
    let rows = sqlx::query(
        "SELECT id, created_at, image_path, label, description, confidence, tags, share_token \
         FROM entries WHERE deleted_at IS NULL ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let entries = rows.into_iter().map(entry_summary_from_row).collect();
    Ok(Json(entries))
}

async fn list_public_entries(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<EntrySummary>>, AppError> {
    let row = sqlx::query("SELECT is_public FROM settings WHERE id = 1")
        .fetch_one(&state.db)
        .await?;
    let is_public: bool = row.get("is_public");

    if !is_public {
        return Err(AppError::not_found("Collection not public"));
    }

    list_entries(State(state)).await
}

async fn get_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<EntryDetail>, AppError> {
    let row = sqlx::query(
        "SELECT id, created_at, image_path, label, description, confidence, tags, share_token \
         FROM entries WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or_else(|| AppError::not_found("Entry not found"))?;
    Ok(Json(entry_detail_from_row(row)))
}

async fn get_shared_entry(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<Json<EntryDetail>, AppError> {
    let row = sqlx::query(
        "SELECT id, created_at, image_path, label, description, confidence, tags, share_token \
         FROM entries WHERE share_token = $1",
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or_else(|| AppError::not_found("Share link not found"))?;
    Ok(Json(entry_detail_from_row(row)))
}

fn entry_summary_from_row(row: sqlx::postgres::PgRow) -> EntrySummary {
    let share_token: Option<String> = row.get("share_token");
    EntrySummary {
        id: row.get("id"),
        created_at: row.get("created_at"),
        image_url: format!("/media/{}", row.get::<String, _>("image_path")),
        label: row.get("label"),
        description: row.get("description"),
        confidence: row.get("confidence"),
        tags: row.get::<Vec<String>, _>("tags"),
        shared: share_token.is_some(),
    }
}

fn entry_detail_from_row(row: sqlx::postgres::PgRow) -> EntryDetail {
    let share_token: Option<String> = row.get("share_token");
    let share_url = share_token
        .as_ref()
        .map(|token| format!("/share/{}", token));

    EntryDetail {
        id: row.get("id"),
        created_at: row.get("created_at"),
        image_url: format!("/media/{}", row.get::<String, _>("image_path")),
        label: row.get("label"),
        description: row.get("description"),
        confidence: row.get("confidence"),
        tags: row.get::<Vec<String>, _>("tags"),
        shared: share_token.is_some(),
        share_url,
    }
}

async fn create_entry(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<CreateEntryResponse>, AppError> {
    let mut image_bytes: Option<Bytes> = None;
    let mut image_mime: Option<String> = None;

    while let Some(field) = multipart.next_field().await? {
        if let Some(name) = field.name() {
            if name == "image" {
                image_mime = field.content_type().map(|v| v.to_string());
                image_bytes = Some(field.bytes().await?);
                break;
            }
        }
    }

    let bytes = image_bytes.ok_or_else(|| AppError::bad_request("Missing image field"))?;
    let mime = image_mime.unwrap_or_else(|| "image/jpeg".to_string());

    let (width, height) = match image::load_from_memory(&bytes) {
        Ok(img) => (Some(img.width() as i32), Some(img.height() as i32)),
        Err(_) => (None, None),
    };

    let id = Uuid::new_v4();
    let extension = match mime.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let filename = format!("images/{}.{}", id, extension);
    let file_path = state.storage_dir.join(&filename);
    tokio::fs::write(&file_path, &bytes).await?;

    let classification = match classify_image(&state, &bytes, &mime).await {
        Ok(classification) => classification,
        Err(err) => {
            if let Err(remove_err) = tokio::fs::remove_file(&file_path).await {
                error!("failed to remove image after classification error: {}", remove_err);
            }
            return Err(err);
        }
    };
    let raw_json = serde_json::to_value(&classification)?;

    sqlx::query(
        "INSERT INTO entries (id, image_path, image_mime, image_width, image_height, label, description, confidence, tags, raw_json) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(id)
    .bind(&filename)
    .bind(&mime)
    .bind(width)
    .bind(height)
    .bind(&classification.label)
    .bind(&classification.description)
    .bind(classification.confidence)
    .bind(&classification.tags)
    .bind(raw_json)
    .execute(&state.db)
    .await?;

    let row = sqlx::query(
        "SELECT id, created_at, image_path, label, description, confidence, tags, share_token \
         FROM entries WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(CreateEntryResponse {
        entry: entry_detail_from_row(row),
    }))
}

async fn soft_delete_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = sqlx::query(
        "UPDATE entries SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Entry not found"));
    }

    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

async fn restore_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query("SELECT deleted_at FROM entries WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

    let Some(row) = row else {
        return Err(AppError::not_found("Entry not found"));
    };

    let deleted_at: Option<DateTime<Utc>> = row.get("deleted_at");
    let deleted_at = deleted_at.ok_or_else(|| AppError::bad_request("Entry not deleted"))?;
    if Utc::now().signed_duration_since(deleted_at) > Duration::hours(1) {
        return Err(AppError::bad_request("Restore window expired"));
    }

    sqlx::query("UPDATE entries SET deleted_at = NULL WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "status": "restored" })))
}

async fn toggle_share(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(payload): Json<SharePayload>,
) -> Result<Json<EntryDetail>, AppError> {
    let share_token = if payload.enable {
        Some(Uuid::new_v4().to_string())
    } else {
        None
    };

    sqlx::query("UPDATE entries SET share_token = $1 WHERE id = $2")
        .bind(&share_token)
        .bind(id)
        .execute(&state.db)
        .await?;

    let row = sqlx::query(
        "SELECT id, created_at, image_path, label, description, confidence, tags, share_token \
         FROM entries WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or_else(|| AppError::not_found("Entry not found"))?;
    Ok(Json(entry_detail_from_row(row)))
}

async fn classify_image(
    state: &AppState,
    bytes: &[u8],
    mime: &str,
) -> Result<Classification, AppError> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);

    let prompt = "Identify the natural scene. Return strict JSON with fields: label (short name), description (1-2 sentences), tags (array of 3-6 lowercase words), confidence (0-1). No markdown.";

    let body = serde_json::json!({
        "model": state.anthropic_model,
        "max_tokens": 512,
        "system": "You are a friendly nature guide who classifies landscapes, plants, animals, and weather. Avoid brand names. Be concise.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": b64
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ]
    });

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &state.anthropic_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::upstream(format!("Failed to reach Anthropic: {}", e)))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::upstream(format!(
            "Anthropic error {}: {}",
            status, text
        )));
    }

    let value: serde_json::Value = res.json().await.map_err(|e| {
        AppError::upstream(format!("Failed to parse Anthropic response: {}", e))
    })?;

    let text = value
        .get("content")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|item| {
                item.get("type")
                    == Some(&serde_json::Value::String("text".to_string()))
            })
        })
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let json_text = extract_json(text).unwrap_or_else(|| text.to_string());
    let parsed: Classification = serde_json::from_str(&json_text).map_err(|e| {
        AppError::upstream(format!("Failed to parse classification JSON: {}", e))
    })?;

    Ok(parsed)
}

fn extract_json(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if start >= end {
        return None;
    }
    Some(text[start..=end].to_string())
}

fn spawn_cleanup(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(600));
        loop {
            interval.tick().await;
            if let Err(err) = cleanup_deleted(&state).await {
                error!("cleanup failed: {}", err);
            }
        }
    });
}

async fn cleanup_deleted(state: &AppState) -> Result<(), AppError> {
    let cutoff = Utc::now() - Duration::hours(1);
    let rows = sqlx::query(
        "SELECT id, image_path FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(cutoff)
    .fetch_all(&state.db)
    .await?;

    for row in rows {
        let image_path: String = row.get("image_path");
        let file_path = state.storage_dir.join(&image_path);
        if let Err(err) = tokio::fs::remove_file(&file_path).await {
            error!("failed to remove image {}: {}", image_path, err);
        }
    }

    sqlx::query(
        "DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(cutoff)
    .execute(&state.db)
    .await?;

    Ok(())
}

async fn ensure_settings(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (id, is_public) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING",
    )
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn upstream(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: err.to_string(),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: err.to_string(),
        }
    }
}

impl From<axum::extract::multipart::MultipartError> for AppError {
    fn from(err: axum::extract::multipart::MultipartError) -> Self {
        AppError {
            status: StatusCode::BAD_REQUEST,
            message: err.to_string(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({
            "error": self.message,
        }));
        (self.status, body).into_response()
    }
}
