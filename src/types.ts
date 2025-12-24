export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  created_at: string;
  updated_at: string;
}

export interface Notebook {
  id: string;
  name: string;
  path: string;
  children: Notebook[];
}

export interface SyncConfig {
  provider: string;
  enabled: boolean;
  credentials: Record<string, string>;
  last_sync?: string;
}

export interface AppSettings {
  font_family: string;
  font_size: number;
  sidebar_width: number;
  notes_width: number;
  favorites: string[];
  tags: Record<string, string[]>;
  notebook_styles: Record<string, NotebookStyle>;
}

export interface NotebookStyle {
  icon: string;
  color: string;
}

export interface SearchResult {
  note_id: string;
  note_title: string;
  notebook_path: string;
  notebook_name: string;
  snippet: string;
  match_count: number;
}

export interface SyncStatus {
  success: boolean;
  message: string;
  files_uploaded: number;
  files_downloaded: number;
  conflicts: SyncConflict[];
}

export interface SyncConflict {
  file_path: string;
  local_modified: string;
  remote_modified: string;
  local_hash: string;
  remote_hash: string;
}

export interface ConflictResolution {
  file_path: string;
  resolution: 'keep_local' | 'keep_remote' | 'keep_both';
}

export interface OpenTab {
  note: Note;
  content: string;
  isDirty: boolean;
}
