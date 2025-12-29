use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub note_id: String,
    pub note_title: String,
    pub notebook_path: String,
    pub notebook_name: String,
    pub snippet: String,
    pub match_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Notebook {
    pub id: String,
    pub name: String,
    pub path: String,
    pub children: Vec<Notebook>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncConfig {
    pub provider: String,
    pub enabled: bool,
    pub credentials: serde_json::Value,
    pub last_sync: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotebookStyle {
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub font_family: String,
    pub font_size: u32,
    pub sidebar_width: u32,
    pub notes_width: u32,
    pub favorites: Vec<String>,
    pub tags: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub notebook_styles: HashMap<String, NotebookStyle>,
    #[serde(default)]
    pub pinned_folders: Vec<String>,
    #[serde(default = "default_auto_save")]
    pub auto_save: bool,
}

fn default_auto_save() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            font_family: "'SF Mono', 'Fira Code', 'Consolas', monospace".to_string(),
            font_size: 14,
            sidebar_width: 200,
            notes_width: 200,
            favorites: Vec::new(),
            tags: HashMap::new(),
            notebook_styles: HashMap::new(),
            pinned_folders: Vec::new(),
            auto_save: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    pub success: bool,
    pub message: String,
    pub files_uploaded: usize,
    pub files_downloaded: usize,
    pub conflicts: Vec<SyncConflict>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncConflict {
    pub file_path: String,
    pub local_modified: String,
    pub remote_modified: String,
    pub local_hash: String,
    pub remote_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConflictResolution {
    pub file_path: String,
    pub resolution: String, // "keep_local", "keep_remote", "keep_both"
}

fn get_file_hash(path: &PathBuf) -> Result<String, String> {
    let content = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    Ok(hex::encode(hasher.finalize()))
}

fn get_app_config_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("azimuth");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("config.json"))
}

#[tauri::command]
fn get_notes_dir() -> Result<String, String> {
    // Check for custom path in app config first
    if let Ok(config_path) = get_app_config_path() {
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(custom_path) = config.get("notes_dir").and_then(|v| v.as_str()) {
                        let path = PathBuf::from(custom_path);
                        if !path.exists() {
                            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
                        }
                        return Ok(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    // Default fallback to ~/Azimuth
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let notes_dir = home.join("Azimuth");
    if !notes_dir.exists() {
        fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;
    }
    Ok(notes_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn set_notes_dir(path: String) -> Result<(), String> {
    let config_path = get_app_config_path()?;
    
    // Read existing config or create new one
    let mut config: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    // Update notes_dir
    config["notes_dir"] = serde_json::Value::String(path);
    
    // Write back
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// App Settings
#[tauri::command]
fn load_settings(base_path: String) -> Result<AppSettings, String> {
    let settings_path = PathBuf::from(&base_path).join(".azimuth_settings.json");
    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(base_path: String, settings: AppSettings) -> Result<(), String> {
    let settings_path = PathBuf::from(&base_path).join(".azimuth_settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// Favorites
#[tauri::command]
fn toggle_favorite(base_path: String, note_path: String) -> Result<AppSettings, String> {
    let mut settings = load_settings(base_path.clone())?;
    if settings.favorites.contains(&note_path) {
        settings.favorites.retain(|p| p != &note_path);
    } else {
        settings.favorites.push(note_path);
    }
    save_settings(base_path, settings.clone())?;
    Ok(settings)
}

#[tauri::command]
fn get_favorites(base_path: String) -> Result<Vec<String>, String> {
    let settings = load_settings(base_path)?;
    Ok(settings.favorites)
}

// Tags
#[tauri::command]
fn set_note_tags(base_path: String, note_path: String, tags: Vec<String>) -> Result<AppSettings, String> {
    let mut settings = load_settings(base_path.clone())?;
    if tags.is_empty() {
        settings.tags.remove(&note_path);
    } else {
        settings.tags.insert(note_path, tags);
    }
    save_settings(base_path, settings.clone())?;
    Ok(settings)
}

#[tauri::command]
fn get_note_tags(base_path: String, note_path: String) -> Result<Vec<String>, String> {
    let settings = load_settings(base_path)?;
    Ok(settings.tags.get(&note_path).cloned().unwrap_or_default())
}

#[tauri::command]
fn get_all_tags(base_path: String) -> Result<Vec<String>, String> {
    let settings = load_settings(base_path)?;
    let mut all_tags: Vec<String> = settings.tags.values().flatten().cloned().collect();
    all_tags.sort();
    all_tags.dedup();
    Ok(all_tags)
}

#[tauri::command]
fn get_notes_by_tag(base_path: String, tag: String) -> Result<Vec<String>, String> {
    let settings = load_settings(base_path)?;
    let notes: Vec<String> = settings.tags
        .iter()
        .filter(|(_, tags)| tags.contains(&tag))
        .map(|(path, _)| path.clone())
        .collect();
    Ok(notes)
}

// Global Search
#[tauri::command]
fn search_notes(base_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    
    for entry in WalkDir::new(&base_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        
        if !is_text_extension(&extension) {
            continue;
        }
        
        if let Ok(content) = fs::read_to_string(path) {
            let content_lower = content.to_lowercase();
            let file_name = path.file_name().unwrap().to_string_lossy().to_string();
            let file_name_lower = file_name.to_lowercase();
            
            // Count matches in content and filename
            let content_matches = content_lower.matches(&query_lower).count();
            let name_matches = if file_name_lower.contains(&query_lower) { 1 } else { 0 };
            let total_matches = content_matches + name_matches;
            
            if total_matches > 0 {
                // Get snippet around first match
                let snippet = if let Some(pos) = content_lower.find(&query_lower) {
                    let start = pos.saturating_sub(50);
                    let end = (pos + query.len() + 50).min(content.len());
                    let mut s = content[start..end].to_string();
                    if start > 0 { s = format!("...{}", s); }
                    if end < content.len() { s = format!("{}...", s); }
                    s.replace('\n', " ")
                } else {
                    content.chars().take(100).collect::<String>()
                };
                
                // Get notebook info
                let parent = path.parent().unwrap();
                let notebook_name = parent.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                
                results.push(SearchResult {
                    note_id: file_name,
                    note_title: path.file_stem().unwrap().to_string_lossy().to_string(),
                    notebook_path: parent.to_string_lossy().to_string(),
                    notebook_name,
                    snippet,
                    match_count: total_matches,
                });
            }
        }
    }
    
    // Sort by match count descending
    results.sort_by(|a, b| b.match_count.cmp(&a.match_count));
    Ok(results)
}

// Directories to skip when scanning for notebooks
const IGNORED_DIRS: &[&str] = &[
    ".", "..", ".git", ".svn", ".hg", "node_modules", "target", "build", "dist",
    ".Trash", ".Spotlight-V100", ".fseventsd", "Library", "Applications",
    ".cache", ".npm", ".cargo", ".rustup", ".local", ".config",
    "__pycache__", ".venv", "venv", ".tox", ".pytest_cache",
    ".DS_Store", "Thumbs.db",
];

#[derive(Clone, Serialize)]
struct LoadComplete {
    notebooks: Vec<Notebook>,
}

const MAX_NOTEBOOKS: usize = 50;
const MAX_ENTRIES_TO_SCAN: usize = 200;

// Trigger async notebook loading - results come via events
#[tauri::command]
fn list_notebooks_async(app: AppHandle, base_path: String) {
    std::thread::spawn(move || {
        let path = PathBuf::from(&base_path);
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        
        let mut notebooks = Vec::new();
        let mut scanned = 0;
        
        if let Ok(read_dir) = std::fs::read_dir(&path) {
            for entry in read_dir.filter_map(|e| e.ok()) {
                scanned += 1;
                
                if scanned > MAX_ENTRIES_TO_SCAN {
                    break;
                }
                
                let name = entry.file_name().to_string_lossy().to_string();
                
                if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
                    continue;
                }
                
                let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                if !is_dir {
                    continue;
                }
                
                notebooks.push(Notebook {
                    id: entry.path().to_string_lossy().to_string(),
                    name: name.clone(),
                    path: entry.path().to_string_lossy().to_string(),
                    children: vec![Notebook {
                        id: String::new(),
                        name: String::new(),
                        path: String::new(),
                        children: vec![],
                    }],
                });
                
                if notebooks.len() >= MAX_NOTEBOOKS {
                    break;
                }
            }
        }
        
        notebooks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let _ = app.emit("load-complete", LoadComplete { notebooks });
    });
}

// Synchronous version for lazy-loading children (small directories)
#[tauri::command]
fn list_notebooks(base_path: String) -> Result<Vec<Notebook>, String> {
    let path = PathBuf::from(&base_path);
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    list_notebooks_simple(&path)
}

// Simple version for import_folder (no progress needed)
fn list_notebooks_simple(path: &PathBuf) -> Result<Vec<Notebook>, String> {
    let mut notebooks = Vec::new();
    
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    
    for entry in entries.filter_map(|e| e.ok()).take(MAX_NOTEBOOKS) {
        let is_dir = match entry.metadata() {
            Ok(m) => m.is_dir(),
            Err(_) => continue,
        };
        
        if !is_dir {
            continue;
        }
        
        let name = entry.file_name().to_string_lossy().to_string();
        
        if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        
        notebooks.push(Notebook {
            id: entry.path().to_string_lossy().to_string(),
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            children: vec![Notebook {
                id: String::new(),
                name: String::new(),
                path: String::new(),
                children: vec![],
            }],
        });
    }
    
    notebooks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(notebooks)
}

#[tauri::command]
fn create_notebook(base_path: String, name: String) -> Result<Notebook, String> {
    let path = PathBuf::from(&base_path).join(&name);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(Notebook {
        id: path.to_string_lossy().to_string(),
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        children: Vec::new(),
    })
}

#[tauri::command]
fn list_notes(notebook_path: String) -> Result<Vec<Note>, String> {
    let path = PathBuf::from(&notebook_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let mut notes = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();
        if file_path.is_file() {
            let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
            let file_name = file_path.file_name().unwrap().to_string_lossy().to_string();
            let stem = file_path.file_stem().unwrap().to_string_lossy().to_string();
            let extension = file_path.extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            
            let content = if is_text_extension(&extension) {
                fs::read_to_string(&file_path).unwrap_or_else(|_| {
                    let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                    format!("[📎 {}]({})", file_name, asset_url)
                })
            } else if is_image_extension(&extension) {
                let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                format!("![{}]({})", file_name, asset_url)
            } else if is_video_extension(&extension) {
                let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                format!("<video controls width=\"100%\" style=\"max-height: 80vh;\">\n  <source src=\"{}\" type=\"video/{}\">\n  Your browser does not support the video tag.\n</video>", asset_url, get_video_mime(&extension))
            } else if is_audio_extension(&extension) {
                let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                format!("<audio controls style=\"width: 100%;\">\n  <source src=\"{}\" type=\"audio/{}\">\n  Your browser does not support the audio tag.\n</audio>", asset_url, get_audio_mime(&extension))
            } else if extension == "pdf" {
                let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                format!("<iframe src=\"{}\" width=\"100%\" height=\"800px\" style=\"border: none;\"></iframe>", asset_url)
            } else {
                let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
                format!("[📎 {}]({})", file_name, asset_url)
            };
            
            notes.push(Note {
                id: file_name.clone(),
                title: stem,
                content,
                folder: notebook_path.clone(),
                created_at: format!("{:?}", metadata.created().unwrap_or(std::time::SystemTime::now())),
                updated_at: format!("{:?}", metadata.modified().unwrap_or(std::time::SystemTime::now())),
            });
        }
    }
    Ok(notes)
}

fn is_image_extension(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "tiff" | "tif")
}

fn is_video_extension(ext: &str) -> bool {
    matches!(ext, "mp4" | "webm" | "mov" | "avi" | "mkv" | "m4v" | "ogv" | "3gp" | "wmv")
}

fn is_audio_extension(ext: &str) -> bool {
    matches!(ext, "mp3" | "wav" | "ogg" | "flac" | "aac" | "m4a" | "wma" | "opus")
}

fn get_video_mime(ext: &str) -> &str {
    match ext {
        "mp4" | "m4v" => "mp4",
        "webm" => "webm",
        "mov" => "quicktime",
        "avi" => "x-msvideo",
        "mkv" => "x-matroska",
        "ogv" => "ogg",
        "3gp" => "3gpp",
        "wmv" => "x-ms-wmv",
        _ => "mp4"
    }
}

fn get_audio_mime(ext: &str) -> &str {
    match ext {
        "mp3" => "mpeg",
        "wav" => "wav",
        "ogg" | "opus" => "ogg",
        "flac" => "flac",
        "aac" | "m4a" => "aac",
        "wma" => "x-ms-wma",
        "webm" => "webm",
        _ => "mpeg"
    }
}

fn is_text_extension(ext: &str) -> bool {
    matches!(ext, 
        "md" | "markdown" | "mdown" | "mkd" |
        "txt" | "text" | "log" |
        "json" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "config" |
        "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "java" | "c" | "cpp" | "h" | "hpp" |
        "go" | "rb" | "php" | "swift" | "kt" | "scala" | "cs" | "fs" | "vb" |
        "lua" | "pl" | "pm" | "r" | "m" | "mm" | "sql" | "sh" | "bash" | "zsh" |
        "fish" | "ps1" | "psm1" | "bat" | "cmd" |
        "html" | "htm" | "css" | "scss" | "sass" | "less" | "xml" | "xsl" | "xslt" |
        "svg" | "vue" | "svelte" |
        "csv" | "tsv" |
        "pem" | "crt" | "cer" | "key" | "pub" |
        "rst" | "adoc" | "asciidoc" | "org" | "tex" | "latex" |
        "env" | "gitignore" | "dockerignore" | "editorconfig" | "prettierrc" |
        "eslintrc" | "babelrc" | "nvmrc" | "npmrc" | "yarnrc" |
        "makefile" | "cmake" | "gradle" | "properties" |
        ""
    )
}

#[tauri::command]
fn save_note(notebook_path: String, note_id: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&notebook_path).join(&note_id);
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_note(notebook_path: String, note_id: String) -> Result<(), String> {
    let note_path = PathBuf::from(&notebook_path).join(&note_id);
    if note_path.exists() {
        fs::remove_file(&note_path).map_err(|e| e.to_string())?;
    }
    
    let stem = PathBuf::from(&note_id)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(note_id.clone());
    let attachments_path = PathBuf::from(&notebook_path).join(&stem);
    if attachments_path.exists() && attachments_path.is_dir() {
        fs::remove_dir_all(&attachments_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_note(notebook_path: String, old_id: String, new_id: String) -> Result<(), String> {
    let old_path = PathBuf::from(&notebook_path).join(&old_id);
    let new_path = PathBuf::from(&notebook_path).join(&new_id);
    
    if !old_path.exists() {
        return Err(format!("File does not exist: {}", old_id));
    }
    
    if new_path.exists() {
        return Err(format!("A file with that name already exists: {}", new_id));
    }
    
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_note(notebook_path: String, note_id: String) -> Result<String, String> {
    let path = PathBuf::from(&notebook_path).join(&note_id);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_binary(file_path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(&file_path);
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_attachment(notebook_path: String, _note_id: String, file_name: String, data: String) -> Result<String, String> {
    // Save attachment directly in the notebook folder (adjacent to notes)
    let notebook_dir = PathBuf::from(&notebook_path);
    
    let file_path = notebook_dir.join(&file_name);
    let decoded = STANDARD.decode(&data).map_err(|e| e.to_string())?;
    fs::write(&file_path, decoded).map_err(|e| e.to_string())?;
    
    let asset_url = format!("asset://localhost/{}", file_path.to_string_lossy().replace(" ", "%20"));
    Ok(asset_url)
}

#[tauri::command]
fn get_attachment_path(notebook_path: String, note_id: String, file_name: String) -> String {
    PathBuf::from(&notebook_path)
        .join(&note_id)
        .join(&file_name)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn list_attachments(notebook_path: String, note_id: String) -> Result<Vec<String>, String> {
    let attachments_dir = PathBuf::from(&notebook_path).join(&note_id);
    if !attachments_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut files = Vec::new();
    for entry in fs::read_dir(&attachments_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    Ok(files)
}

#[tauri::command]
fn import_folder(base_path: String, folder_path: String) -> Result<Notebook, String> {
    let source = PathBuf::from(&folder_path);
    if !source.exists() || !source.is_dir() {
        return Err("Invalid folder path".to_string());
    }
    
    let folder_name = source
        .file_name()
        .ok_or("Could not get folder name")?
        .to_string_lossy()
        .to_string();
    
    let dest = PathBuf::from(&base_path).join(&folder_name);
    
    if dest.exists() {
        let children = list_notebooks_simple(&dest)?;
        return Ok(Notebook {
            id: dest.to_string_lossy().to_string(),
            name: folder_name,
            path: dest.to_string_lossy().to_string(),
            children,
        });
    }
    
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    import_folder_contents(&source, &dest).map_err(|e| e.to_string())?;
    
    let children = list_notebooks_simple(&dest)?;
    Ok(Notebook {
        id: dest.to_string_lossy().to_string(),
        name: folder_name,
        path: dest.to_string_lossy().to_string(),
        children,
    })
}

fn import_folder_contents(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        if src_path.is_dir() {
            let dst_subdir = dst.join(&file_name);
            copy_dir_recursive(&src_path, &dst_subdir)?;
        } else if src_path.is_file() {
            let dst_path = dst.join(&file_name);
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn is_directory(path: String) -> bool {
    PathBuf::from(&path).is_dir()
}

#[tauri::command]
fn move_notebook(source_path: String, target_path: String) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    let target_dir = PathBuf::from(&target_path);
    
    if !source.exists() {
        return Err(format!("Source folder does not exist: {}", source_path));
    }
    
    if !source.is_dir() {
        return Err(format!("Source is not a directory: {}", source_path));
    }
    
    if !target_dir.exists() {
        return Err(format!("Target folder does not exist: {}", target_path));
    }
    
    let folder_name = source
        .file_name()
        .ok_or("Could not get folder name")?
        .to_string_lossy()
        .to_string();
    
    let destination = target_dir.join(&folder_name);
    
    // Check if destination already exists
    if destination.exists() {
        return Err(format!("A folder named '{}' already exists in the target location", folder_name));
    }
    
    // Check if trying to move into itself
    if target_dir.starts_with(&source) {
        return Err("Cannot move a folder into itself".to_string());
    }
    
    // Perform the move (rename)
    match fs::rename(&source, &destination) {
        Ok(_) => Ok(()),
        Err(e) => {
            // If rename fails (e.g., cross-device), try copy and delete
            copy_dir_recursive(&source, &destination)
                .map_err(|copy_err| format!("Failed to move folder: {} (copy failed: {})", e, copy_err))?;
            fs::remove_dir_all(&source)
                .map_err(|del_err| format!("Folder copied but failed to remove original: {}", del_err))?;
            Ok(())
        }
    }
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}


// Cloud Sync Implementation
#[tauri::command]
async fn sync_to_s3(
    bucket: String,
    region: String,
    access_key: String,
    secret_key: String,
    notes_path: String,
) -> Result<SyncStatus, String> {
    use aws_config::Region;
    use aws_sdk_s3::config::Credentials;
    use aws_sdk_s3::Client;
    use aws_sdk_s3::primitives::ByteStream;
    
    let credentials = Credentials::new(&access_key, &secret_key, None, None, "azimuth");
    let config = aws_sdk_s3::Config::builder()
        .region(Region::new(region))
        .credentials_provider(credentials)
        .build();
    
    let client = Client::from_conf(config);
    let base_path = PathBuf::from(&notes_path);
    
    let mut files_uploaded = 0;
    let mut files_downloaded = 0;
    let conflicts = Vec::new();
    
    // Get local files
    let mut local_files: HashMap<String, (String, String)> = HashMap::new(); // path -> (hash, modified)
    for entry in WalkDir::new(&base_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        let relative = path.strip_prefix(&base_path).unwrap().to_string_lossy().to_string();
        if let Ok(hash) = get_file_hash(&path.to_path_buf()) {
            let modified = fs::metadata(path)
                .and_then(|m| m.modified())
                .map(|t| format!("{:?}", t))
                .unwrap_or_default();
            local_files.insert(relative, (hash, modified));
        }
    }
    
    // List remote files
    let mut remote_files: HashMap<String, String> = HashMap::new(); // path -> etag
    let list_result = client.list_objects_v2()
        .bucket(&bucket)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if let Some(contents) = list_result.contents {
        for obj in contents {
            if let (Some(key), Some(etag)) = (obj.key, obj.e_tag) {
                remote_files.insert(key, etag.trim_matches('"').to_string());
            }
        }
    }
    
    // Upload new/modified local files
    for (path, (local_hash, _)) in &local_files {
        let should_upload = match remote_files.get(path) {
            None => true,
            Some(remote_etag) => remote_etag != local_hash,
        };
        
        if should_upload {
            let full_path = base_path.join(path);
            let body = ByteStream::from_path(&full_path).await.map_err(|e| e.to_string())?;
            
            client.put_object()
                .bucket(&bucket)
                .key(path)
                .body(body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            files_uploaded += 1;
        }
    }
    
    // Download new remote files
    for (path, _) in &remote_files {
        if !local_files.contains_key(path) {
            let result = client.get_object()
                .bucket(&bucket)
                .key(path)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            let data = result.body.collect().await.map_err(|e| e.to_string())?;
            let full_path = base_path.join(path);
            
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            
            fs::write(&full_path, data.into_bytes()).map_err(|e| e.to_string())?;
            files_downloaded += 1;
        }
    }
    
    Ok(SyncStatus {
        success: true,
        message: format!("Sync complete: {} uploaded, {} downloaded", files_uploaded, files_downloaded),
        files_uploaded,
        files_downloaded,
        conflicts,
    })
}

#[tauri::command]
async fn sync_to_dropbox(
    access_token: String,
    notes_path: String,
) -> Result<SyncStatus, String> {
    let client = reqwest::Client::new();
    let base_path = PathBuf::from(&notes_path);
    
    let mut files_uploaded = 0;
    let mut files_downloaded = 0;
    let conflicts = Vec::new();
    
    // List local files
    for entry in WalkDir::new(&base_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        
        let relative = path.strip_prefix(&base_path).unwrap().to_string_lossy().to_string();
        let dropbox_path = format!("/Azimuth/{}", relative);
        
        let content = fs::read(path).map_err(|e| e.to_string())?;
        
        let response = client.post("https://content.dropboxapi.com/2/files/upload")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Dropbox-API-Arg", serde_json::json!({
                "path": dropbox_path,
                "mode": "overwrite",
                "autorename": false,
                "mute": true
            }).to_string())
            .header("Content-Type", "application/octet-stream")
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        if response.status().is_success() {
            files_uploaded += 1;
        }
    }
    
    // List and download remote files
    let list_response = client.post("https://api.dropboxapi.com/2/files/list_folder")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "path": "/Azimuth",
            "recursive": true
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if list_response.status().is_success() {
        let list_data: serde_json::Value = list_response.json().await.map_err(|e| e.to_string())?;
        
        if let Some(entries) = list_data["entries"].as_array() {
            for entry in entries {
                if entry[".tag"] == "file" {
                    let remote_path = entry["path_display"].as_str().unwrap_or("");
                    let relative = remote_path.strip_prefix("/Azimuth/").unwrap_or(remote_path);
                    let local_path = base_path.join(relative);
                    
                    if !local_path.exists() {
                        let download_response = client.post("https://content.dropboxapi.com/2/files/download")
                            .header("Authorization", format!("Bearer {}", access_token))
                            .header("Dropbox-API-Arg", serde_json::json!({
                                "path": remote_path
                            }).to_string())
                            .send()
                            .await
                            .map_err(|e| e.to_string())?;
                        
                        if download_response.status().is_success() {
                            let content = download_response.bytes().await.map_err(|e| e.to_string())?;
                            if let Some(parent) = local_path.parent() {
                                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                            }
                            fs::write(&local_path, content).map_err(|e| e.to_string())?;
                            files_downloaded += 1;
                        }
                    }
                }
            }
        }
    }
    
    Ok(SyncStatus {
        success: true,
        message: format!("Dropbox sync complete: {} uploaded, {} downloaded", files_uploaded, files_downloaded),
        files_uploaded,
        files_downloaded,
        conflicts,
    })
}

#[tauri::command]
async fn sync_to_onedrive(
    access_token: String,
    notes_path: String,
) -> Result<SyncStatus, String> {
    let client = reqwest::Client::new();
    let base_path = PathBuf::from(&notes_path);
    
    let mut files_uploaded = 0;
    let mut files_downloaded = 0;
    let conflicts = Vec::new();
    
    // Upload local files
    for entry in WalkDir::new(&base_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        
        let relative = path.strip_prefix(&base_path).unwrap().to_string_lossy().to_string();
        let onedrive_path = format!("/drive/root:/Azimuth/{}:/content", relative);
        
        let content = fs::read(path).map_err(|e| e.to_string())?;
        
        let response = client.put(format!("https://graph.microsoft.com/v1.0{}", onedrive_path))
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/octet-stream")
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        if response.status().is_success() {
            files_uploaded += 1;
        }
    }
    
    // List remote files
    let list_response = client.get("https://graph.microsoft.com/v1.0/drive/root:/Azimuth:/children")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if list_response.status().is_success() {
        let list_data: serde_json::Value = list_response.json().await.map_err(|e| e.to_string())?;
        
        if let Some(items) = list_data["value"].as_array() {
            for item in items {
                if item["file"].is_object() {
                    let name = item["name"].as_str().unwrap_or("");
                    let local_path = base_path.join(name);
                    
                    if !local_path.exists() {
                        if let Some(download_url) = item["@microsoft.graph.downloadUrl"].as_str() {
                            let download_response = client.get(download_url)
                                .send()
                                .await
                                .map_err(|e| e.to_string())?;
                            
                            if download_response.status().is_success() {
                                let content = download_response.bytes().await.map_err(|e| e.to_string())?;
                                fs::write(&local_path, content).map_err(|e| e.to_string())?;
                                files_downloaded += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(SyncStatus {
        success: true,
        message: format!("OneDrive sync complete: {} uploaded, {} downloaded", files_uploaded, files_downloaded),
        files_uploaded,
        files_downloaded,
        conflicts,
    })
}

#[tauri::command]
async fn sync_to_google_drive(
    access_token: String,
    notes_path: String,
) -> Result<SyncStatus, String> {
    let client = reqwest::Client::new();
    let base_path = PathBuf::from(&notes_path);
    
    let mut files_uploaded = 0;
    let files_downloaded = 0;
    let conflicts = Vec::new();
    
    // Find or create Azimuth folder
    let search_response = client.get("https://www.googleapis.com/drive/v3/files")
        .header("Authorization", format!("Bearer {}", access_token))
        .query(&[
            ("q", "name='Azimuth' and mimeType='application/vnd.google-apps.folder' and trashed=false"),
            ("fields", "files(id,name)")
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let search_data: serde_json::Value = search_response.json().await.map_err(|e| e.to_string())?;
    
    let folder_id = if let Some(files) = search_data["files"].as_array() {
        if let Some(folder) = files.first() {
            folder["id"].as_str().unwrap_or("").to_string()
        } else {
            // Create folder
            let create_response = client.post("https://www.googleapis.com/drive/v3/files")
                .header("Authorization", format!("Bearer {}", access_token))
                .json(&serde_json::json!({
                    "name": "Azimuth",
                    "mimeType": "application/vnd.google-apps.folder"
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            let create_data: serde_json::Value = create_response.json().await.map_err(|e| e.to_string())?;
            create_data["id"].as_str().unwrap_or("").to_string()
        }
    } else {
        return Err("Failed to search for folder".to_string());
    };
    
    // Upload local files using simple upload (for files < 5MB)
    for entry in WalkDir::new(&base_path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        let content = fs::read(path).map_err(|e| e.to_string())?;
        
        // Use simple upload API
        let upload_url = format!(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=media&name={}&parents={}",
            urlencoding::encode(&file_name),
            folder_id
        );
        
        let response = client.post(&upload_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/octet-stream")
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        if response.status().is_success() {
            files_uploaded += 1;
        }
    }
    
    Ok(SyncStatus {
        success: true,
        message: format!("Google Drive sync complete: {} uploaded, {} downloaded", files_uploaded, files_downloaded),
        files_uploaded,
        files_downloaded,
        conflicts,
    })
}

#[tauri::command]
fn resolve_conflict(base_path: String, resolution: ConflictResolution) -> Result<(), String> {
    let file_path = PathBuf::from(&base_path).join(&resolution.file_path);
    let conflict_path = file_path.with_extension("conflict");
    
    match resolution.resolution.as_str() {
        "keep_local" => {
            if conflict_path.exists() {
                fs::remove_file(&conflict_path).map_err(|e| e.to_string())?;
            }
        }
        "keep_remote" => {
            if conflict_path.exists() {
                fs::rename(&conflict_path, &file_path).map_err(|e| e.to_string())?;
            }
        }
        "keep_both" => {
            let stem = file_path.file_stem().unwrap().to_string_lossy();
            let ext = file_path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let new_name = format!("{}_conflict.{}", stem, ext);
            let new_path = file_path.with_file_name(new_name);
            if conflict_path.exists() {
                fs::rename(&conflict_path, &new_path).map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Invalid resolution type".to_string()),
    }
    
    Ok(())
}

#[tauri::command]
fn save_sync_config(base_path: String, config: SyncConfig) -> Result<(), String> {
    let config_path = PathBuf::from(&base_path).join(".sync_config.json");
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_sync_config(base_path: String) -> Result<Option<SyncConfig>, String> {
    let config_path = PathBuf::from(&base_path).join(".sync_config.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: SyncConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(config))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
            
            // Build the Settings menu item
            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            
            // Build the app submenu (macOS app menu)
            let app_submenu = SubmenuBuilder::new(app, "Azimuth")
                .item(&PredefinedMenuItem::about(app, Some("About Azimuth"), None)?)
                .separator()
                .item(&settings_item)
                .separator()
                .item(&PredefinedMenuItem::services(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, None)?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;
            
            // Build the Edit submenu
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;
            
            // Build the Window submenu
            let window_submenu = SubmenuBuilder::new(app, "Window")
                .item(&PredefinedMenuItem::minimize(app, None)?)
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::close_window(app, None)?)
                .build()?;
            
            // Build the Help submenu
            let help_item = MenuItemBuilder::with_id("help", "Azimuth Help")
                .accelerator("CmdOrCtrl+?")
                .build(app)?;
            
            let help_submenu = SubmenuBuilder::new(app, "Help")
                .item(&help_item)
                .build()?;
            
            // Build the full menu
            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&window_submenu)
                .item(&help_submenu)
                .build()?;
            
            app.set_menu(menu)?;
            
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "settings" {
                // Emit event to frontend to open settings
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("open-settings", ());
                }
            }
            if event.id().as_ref() == "help" {
                // Emit event to frontend to open help
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("open-help", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_notes_dir,
            set_notes_dir,
            list_notebooks,
            list_notebooks_async,
            create_notebook,
            list_notes,
            save_note,
            delete_note,
            rename_note,
            read_note,
            read_file_binary,
            save_attachment,
            get_attachment_path,
            list_attachments,
            import_folder,
            is_directory,
            move_notebook,
            // Settings
            load_settings,
            save_settings,
            // Favorites
            toggle_favorite,
            get_favorites,
            // Tags
            set_note_tags,
            get_note_tags,
            get_all_tags,
            get_notes_by_tag,
            // Search
            search_notes,
            // Sync
            sync_to_s3,
            sync_to_dropbox,
            sync_to_onedrive,
            sync_to_google_drive,
            resolve_conflict,
            save_sync_config,
            load_sync_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
