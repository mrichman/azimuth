import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watch } from '@tauri-apps/plugin-fs';
import MDEditor, { commands } from '@uiw/react-md-editor';
import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';
import { Note, Notebook, SyncConfig, AppSettings, SearchResult, SyncStatus, OpenTab, NotebookStyle } from './types';
import './App.css';

interface LoadComplete {
  notebooks: Notebook[];
}

function App() {
  const [notesDir, setNotesDir] = useState<string>('');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [content, setContent] = useState<string>('');
  
  // Tabs state
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNoteName, setNewNoteName] = useState('');
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  
  // New feature states
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  
  // Local state for settings inputs (to prevent modal dismissal on typing)
  const [localEditorFont, setLocalEditorFont] = useState('');
  const [localUiFont, setLocalUiFont] = useState('');
  
  // Drag and drop state for notebooks
  const [draggedNotebook, setDraggedNotebook] = useState<Notebook | null>(null);
  const [draggedNote, setDraggedNote] = useState<Note | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [isChangingDirectory, setIsChangingDirectory] = useState(true); // Start true for initial load
  
  // Notes sorting
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'created'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Notebook customization
  const [customizingNotebook, setCustomizingNotebook] = useState<Notebook | null>(null);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ 
    x: number; 
    y: number; 
    notebook?: Notebook;
    notePath?: string;
    note?: Note;
    inFavorites: boolean;
  } | null>(null);
  
  // Renaming state
  const [renamingNote, setRenamingNote] = useState<Note | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [notesWidth, setNotesWidth] = useState(200);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingNotes, setIsResizingNotes] = useState(false);
  const [editorSplitRatio, setEditorSplitRatio] = useState(50); // percentage for editor width
  const [isResizingEditor, setIsResizingEditor] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  const notesDirRef = useRef(notesDir);
  const notebooksRef = useRef(notebooks);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const selectedNoteRef = useRef(selectedNote);
  const selectedNotebookRef = useRef(selectedNotebook);

  useEffect(() => { notesDirRef.current = notesDir; }, [notesDir]);
  useEffect(() => { notebooksRef.current = notebooks; }, [notebooks]);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { selectedNoteRef.current = selectedNote; }, [selectedNote]);
  useEffect(() => { selectedNotebookRef.current = selectedNotebook; }, [selectedNotebook]);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  
  // Initialize local font state when settings modal opens
  useEffect(() => {
    if (showSettings && settings) {
      setLocalEditorFont(settings.font_family || "'SF Mono', 'Fira Code', 'Consolas', monospace");
      setLocalUiFont(settings.ui_font_family || "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    }
  }, [showSettings, settings]);
  
  // Update window title with root directory
  useEffect(() => {
    if (notesDir) {
      getCurrentWindow().setTitle(`Azimuth - ${notesDir}`);
    }
  }, [notesDir]);
  
  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Tab management functions
  const openNoteInTab = (note: Note) => {
    const existingTab = openTabs.find(t => t.note.id === note.id && t.note.folder === note.folder);
    if (existingTab) {
      setActiveTabId(note.id);
      setSelectedNote(note);
      setContent(existingTab.content);
    } else {
      const newTab: OpenTab = { note, content: note.content, isDirty: false };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(note.id);
      setSelectedNote(note);
      setContent(note.content);
    }
  };

  const closeTab = (noteId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tab = openTabs.find(t => t.note.id === noteId);
    if (tab?.isDirty && !confirm('This note has unsaved changes. Close anyway?')) return;
    
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.note.id !== noteId);
      
      // Handle switching to another tab if we're closing the active one
      if (activeTabId === noteId) {
        if (newTabs.length > 0) {
          const lastTab = newTabs[newTabs.length - 1];
          // Use setTimeout to avoid state update conflicts
          setTimeout(() => {
            setActiveTabId(lastTab.note.id);
            setSelectedNote(lastTab.note);
            setContent(lastTab.content);
          }, 0);
        } else {
          setTimeout(() => {
            setActiveTabId(null);
            setSelectedNote(null);
            setContent('');
          }, 0);
        }
      }
      
      return newTabs;
    });
  };

  const switchTab = (noteId: string) => {
    const tab = openTabs.find(t => t.note.id === noteId);
    if (tab) {
      // Save current content to current tab before switching
      if (activeTabId) {
        setOpenTabs(prev => prev.map(t => 
          t.note.id === activeTabId ? { ...t, content, isDirty: t.content !== content || t.isDirty } : t
        ));
      }
      setActiveTabId(noteId);
      setSelectedNote(tab.note);
      setContent(tab.content);
    }
  };

  // Update tab content when editing
  useEffect(() => {
    if (activeTabId && content !== undefined) {
      setOpenTabs(prev => prev.map(t => {
        if (t.note.id === activeTabId) {
          const isDirty = t.note.content !== content;
          return { ...t, content, isDirty };
        }
        return t;
      }));
    }
  }, [content, activeTabId]);

  // Status bar calculations
  const getWordCount = (text: string): number => {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  };

  const getCharCount = (text: string): number => {
    return text.length;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Abbreviate path: /Users/john/Documents/notes/work -> /U/j/D/n/work
  // Keeps the last directory and filename full, abbreviates intermediate ones
  const abbreviatePath = (fullPath: string): string => {
    const parts = fullPath.split('/');
    if (parts.length <= 3) return fullPath;
    
    // Keep last 2 parts full (parent folder + filename), abbreviate the rest
    const abbreviated = parts.slice(0, -2).map(p => p ? p[0] : '');
    const kept = parts.slice(-2);
    return [...abbreviated, ...kept].join('/');
  };

  // Shortcut command expansion
  const expandShortcuts = (text: string): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateOnly = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeOnly = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    
    return text
      .replace(/:date\b/g, dateTime)
      .replace(/:today\b/g, dateOnly)
      .replace(/:time\b/g, timeOnly);
  };

  // Sort notes
  const sortedNotes = [...notes].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'updated':
        comparison = a.updated_at.localeCompare(b.updated_at);
        break;
      case 'created':
        comparison = a.created_at.localeCompare(b.created_at);
        break;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  // Notebook customization
  const notebookIcons = ['📓', '📁', '📂', '📚', '📖', '📕', '📗', '📘', '📙', '🗂️', '💼', '🎨', '🎵', '🎬', '📷', '💻', '🔬', '🧪', '📊', '📈', '✏️', '📝', '🗒️', '📋', '🏠', '💡', '⭐', '❤️', '🔥', '🌟'];
  const notebookColors = [
    '#cdd6f4', // default (text color)
    '#f38ba8', // red
    '#fab387', // peach
    '#f9e2af', // yellow
    '#a6e3a1', // green
    '#94e2d5', // teal
    '#89b4fa', // blue
    '#b4befe', // lavender
    '#cba6f7', // mauve
    '#f5c2e7', // pink
    '#eba0ac', // maroon
  ];

  const getNotebookStyle = (notebookPath: string): NotebookStyle => {
    return settings?.notebook_styles?.[notebookPath] || { icon: '📓', color: '#cdd6f4' };
  };

  const updateNotebookStyle = async (notebookPath: string, style: Partial<NotebookStyle>) => {
    if (!settings || !notesDir) return;
    const currentStyle = getNotebookStyle(notebookPath);
    const newStyle = { ...currentStyle, ...style };
    const newSettings = {
      ...settings,
      notebook_styles: {
        ...settings.notebook_styles,
        [notebookPath]: newStyle,
      },
    };
    setSettings(newSettings);
    await invoke('save_settings', { basePath: notesDir, settings: newSettings });
  };

  // Pin/unpin folders
  const isPinned = (notebookPath: string): boolean => {
    return settings?.pinned_folders?.includes(notebookPath) || false;
  };

  const togglePin = async (notebookPath: string) => {
    if (!settings || !notesDir) return;
    const currentPinned = settings.pinned_folders || [];
    const newPinned = currentPinned.includes(notebookPath)
      ? currentPinned.filter(p => p !== notebookPath)
      : [...currentPinned, notebookPath];
    const newSettings = { ...settings, pinned_folders: newPinned };
    setSettings(newSettings);
    await invoke('save_settings', { basePath: notesDir, settings: newSettings });
  };

  const toggleFavoriteByPath = async (notePath: string) => {
    if (!notesDir) return;
    try {
      const newSettings = await invoke<AppSettings>('toggle_favorite', { basePath: notesDir, notePath });
      setFavorites(newSettings.favorites);
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  // File type icons
  const getFileIcon = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    
    // Markdown
    if (['md', 'markdown', 'mdown', 'mkd'].includes(ext)) return '📝';
    
    // Images
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'].includes(ext)) return '🖼️';
    
    // Videos
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv', '3gp', 'wmv'].includes(ext)) return '🎬';
    
    // Audio
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext)) return '🎵';
    
    // PDF
    if (ext === 'pdf') return '📕';
    
    // Word documents
    if (['docx', 'doc'].includes(ext)) return '📘';
    
    // Excel spreadsheets
    if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext)) return '📊';
    
    // PowerPoint presentations
    if (['pptx', 'ppt'].includes(ext)) return '📙';
    
    // Code - JavaScript/TypeScript
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return '🟨';
    
    // Code - Python
    if (['py', 'pyw', 'pyi'].includes(ext)) return '🐍';
    
    // Code - Rust
    if (ext === 'rs') return '🦀';
    
    // Code - Go
    if (ext === 'go') return '🐹';
    
    // Code - Ruby
    if (['rb', 'erb'].includes(ext)) return '💎';
    
    // Code - Java/Kotlin
    if (['java', 'kt', 'kts'].includes(ext)) return '☕';
    
    // Code - C/C++
    if (['c', 'cpp', 'cc', 'h', 'hpp', 'hh'].includes(ext)) return '⚙️';
    
    // Code - Swift
    if (ext === 'swift') return '🐦';
    
    // Code - PHP
    if (ext === 'php') return '🐘';
    
    // Web - HTML/CSS
    if (['html', 'htm', 'xhtml'].includes(ext)) return '🌐';
    if (['css', 'scss', 'sass', 'less'].includes(ext)) return '🎨';
    
    // Data - JSON/YAML/XML
    if (['json', 'jsonc'].includes(ext)) return '📋';
    if (['yaml', 'yml'].includes(ext)) return '📋';
    if (['xml', 'xsl', 'xslt'].includes(ext)) return '📋';
    
    // Config
    if (['toml', 'ini', 'cfg', 'conf', 'config', 'env'].includes(ext)) return '⚙️';
    
    // Shell
    if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) return '💻';
    
    // Text
    if (['txt', 'text', 'log'].includes(ext)) return '📄';
    
    // CSV/Data
    if (['csv', 'tsv'].includes(ext)) return '📊';
    
    // SQL
    if (ext === 'sql') return '🗃️';
    
    // Archives
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '📦';
    
    // Default
    return '📄';
  };

  const handleContentChange = (val: string | undefined) => {
    if (!isEditableFile(selectedNote?.id || '')) return;
    const newContent = val || '';
    const expanded = expandShortcuts(newContent);
    setContent(expanded);
    
    // Auto-save after 1 second of no typing (if enabled)
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(async () => {
      // Check if auto-save is enabled
      if (!settingsRef.current?.auto_save) return;
      
      const note = selectedNoteRef.current;
      const notebook = selectedNotebookRef.current;
      const currentContent = contentRef.current;
      
      if (note && notebook && isEditableFile(note.id)) {
        try {
          await invoke('save_note', { notebookPath: notebook.path, noteId: note.id, content: currentContent });
          const title = currentContent.split('\n')[0].replace(/^#\s*/, '') || 'Untitled';
          const updatedNote = { ...note, content: currentContent, title, updated_at: new Date().toISOString() };
          setSelectedNote(updatedNote);
          setOpenTabs(prev => prev.map(t => 
            t.note.id === note.id ? { ...t, note: updatedNote, content: currentContent, isDirty: false } : t
          ));
        } catch (e) {
          console.error('Auto-save failed:', e);
        }
      }
    }, 1000);
  };

  // Helper to merge new notebooks with existing ones, preserving loaded children
  const mergeNotebooks = (newNotebooks: Notebook[], existingNotebooks: Notebook[]): Notebook[] => {
    return newNotebooks.map(newNb => {
      const existing = existingNotebooks.find(e => e.path === newNb.path);
      if (existing && hasRealChildren(existing)) {
        // Keep the existing loaded children entirely
        return {
          ...newNb,
          children: existing.children
        };
      }
      return newNb;
    });
  };

  // Store pending init state for completion handler
  const pendingInitRef = useRef<{ dir: string } | null>(null);

  // Listen for load-complete events from Rust
  useEffect(() => {
    let mounted = true;
    let unlistenLoadComplete: (() => void) | undefined;
    let unlistenOpenSettings: (() => void) | undefined;
    let unlistenOpenHelp: (() => void) | undefined;
    
    const setup = async () => {
      try {
        unlistenLoadComplete = await listen<LoadComplete>('load-complete', async (event) => {
          if (!mounted) return;
          
          // Merge new notebooks with existing ones to preserve loaded children
          setNotebooks(prev => {
            if (prev.length === 0) {
              return event.payload.notebooks;
            }
            return mergeNotebooks(event.payload.notebooks, prev);
          });
          
          // Complete the rest of initialization if this was from initApp
          if (pendingInitRef.current) {
            const dir = pendingInitRef.current.dir;
            pendingInitRef.current = null;
            
            try {
              const config = await invoke<SyncConfig | null>('load_sync_config', { basePath: dir });
              if (config) setSyncConfig(config);
              
              const appSettings = await invoke<AppSettings>('load_settings', { basePath: dir });
              setSettings(appSettings);
              setSidebarWidth(appSettings.sidebar_width);
              setNotesWidth(appSettings.notes_width);
              if (appSettings.editor_split_ratio) {
                setEditorSplitRatio(appSettings.editor_split_ratio);
              }
              setFavorites(appSettings.favorites);
              
              const tags = await invoke<string[]>('get_all_tags', { basePath: dir });
              setAllTags(tags);
            } catch (e) {
              console.error('Failed to load settings:', e);
            }
          }
          
          setIsChangingDirectory(false);
        });
        
        // Listen for open-settings event from native menu
        unlistenOpenSettings = await listen('open-settings', () => {
          if (mounted) {
            setShowSettings(true);
          }
        });
        
        // Listen for open-help event from native menu
        unlistenOpenHelp = await listen('open-help', () => {
          if (mounted) {
            setShowHelp(true);
          }
        });
        
        initApp();
      } catch (e) {
        console.error('Failed to set up listeners:', e);
      }
    };
    
    setup();
    
    return () => {
      mounted = false;
      unlistenLoadComplete?.();
      unlistenOpenSettings?.();
      unlistenOpenHelp?.();
    };
  }, []);

  useEffect(() => {
    if (!notesDir) return;
    
    // Don't watch very large directories like $HOME
    // Check if this looks like a home directory or root
    const isLargeDir = notesDir === '/' || 
                       notesDir.split('/').filter(Boolean).length <= 2;
    
    if (isLargeDir) {
      return;
    }
    
    let stopWatching: (() => void) | undefined;
    const startWatching = async () => {
      try {
        stopWatching = await watch(notesDir, async () => {
          invoke('list_notebooks_async', { basePath: notesDirRef.current });
          
          if (selectedNotebook) {
            try {
              const notesList = await invoke<Note[]>('list_notes', { notebookPath: selectedNotebook.path });
              setNotes(notesList);
              
              if (selectedNote && !notesList.some(n => n.id === selectedNote.id)) {
                setSelectedNote(null);
                setContent('');
              }
            } catch (err) {
              console.error('Failed to refresh notes:', err);
            }
          }
        }, { recursive: false }); // Don't watch recursively
      } catch (err) {
        console.error('Failed to watch directory:', err);
      }
    };
    
    startWatching();
    return () => { if (stopWatching) stopWatching(); };
  }, [notesDir, selectedNotebook, selectedNote]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (selectedNote && selectedNotebook && isEditableFile(selectedNote.id)) {
          saveNote();
        }
      }
      // Cmd+K to search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
      // Cmd+P for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        setCommandQuery('');
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        if (showCommandPalette) {
          setShowCommandPalette(false);
          setCommandQuery('');
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNote, selectedNotebook, content, showCommandPalette]);

  // Resizable panel handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(150, Math.min(400, e.clientX));
        setSidebarWidth(newWidth);
      }
      if (isResizingNotes) {
        const newWidth = Math.max(150, Math.min(400, e.clientX - sidebarWidth));
        setNotesWidth(newWidth);
      }
      if (isResizingEditor && editorWrapperRef.current) {
        const rect = editorWrapperRef.current.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const percentage = Math.max(20, Math.min(80, (relativeX / rect.width) * 100));
        setEditorSplitRatio(percentage);
      }
    };
    
    const handleMouseUp = () => {
      document.body.classList.remove('resizing');
      if (isResizingSidebar || isResizingNotes) {
        setIsResizingSidebar(false);
        setIsResizingNotes(false);
        if (settings && notesDir) {
          const newSettings = { ...settings, sidebar_width: sidebarWidth, notes_width: notesWidth };
          invoke('save_settings', { basePath: notesDir, settings: newSettings });
        }
      }
      if (isResizingEditor) {
        setIsResizingEditor(false);
        if (settings && notesDir) {
          const newSettings = { ...settings, editor_split_ratio: editorSplitRatio };
          invoke('save_settings', { basePath: notesDir, settings: newSettings });
        }
      }
    };
    
    if (isResizingSidebar || isResizingNotes || isResizingEditor) {
      document.body.classList.add('resizing');
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingNotes, isResizingEditor, sidebarWidth, notesWidth, editorSplitRatio, settings, notesDir]);

  const initApp = async () => {
    setIsChangingDirectory(true);
    
    // Use setTimeout to let React render the loading state first
    setTimeout(async () => {
      try {
        const dir = await invoke<string>('get_notes_dir');
        setNotesDir(dir);
        
        // Store dir for completion handler
        pendingInitRef.current = { dir };
        
        invoke('list_notebooks_async', { basePath: dir });
      } catch (e) {
        console.error('Failed to initialize:', e);
        setIsChangingDirectory(false);
      }
    }, 50);
  };

  const loadNotes = useCallback(async (notebook: Notebook) => {
    try {
      const notesList = await invoke<Note[]>('list_notes', { notebookPath: notebook.path });
      setNotes(notesList);
    } catch (e) {
      console.error('Failed to load notes:', e);
    }
  }, []);

  // Load notes for selected notebook, or root directory if none selected
  useEffect(() => {
    if (selectedNotebook) {
      loadNotes(selectedNotebook);
    } else if (notesDir) {
      // Load root directory files when no notebook is selected
      const loadRootNotes = async () => {
        try {
          const notesList = await invoke<Note[]>('list_notes', { notebookPath: notesDir });
          setNotes(notesList);
        } catch (e) {
          console.error('Failed to load root notes:', e);
          setNotes([]);
        }
      };
      loadRootNotes();
    }
  }, [selectedNotebook, notesDir, loadNotes]);

  // Load note tags when note is selected
  useEffect(() => {
    if (selectedNote && notesDir) {
      const notePath = `${selectedNote.folder}/${selectedNote.id}`;
      invoke<string[]>('get_note_tags', { basePath: notesDir, notePath })
        .then(setNoteTags)
        .catch(console.error);
    } else {
      setNoteTags([]);
    }
  }, [selectedNote, notesDir]);

  // Search
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await invoke<SearchResult[]>('search_notes', { basePath: notesDir, query });
      setSearchResults(results);
    } catch (e) {
      console.error('Search failed:', e);
    }
  };

  const selectSearchResult = async (result: SearchResult) => {
    const notebook = findNotebookByPath(notebooks, result.notebook_path);
    if (notebook) {
      setSelectedNotebook(notebook);
      const notesList = await invoke<Note[]>('list_notes', { notebookPath: result.notebook_path });
      setNotes(notesList);
      const note = notesList.find(n => n.id === result.note_id);
      if (note) {
        openNoteInTab(note);
      }
    }
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const findNotebookByPath = (nbs: Notebook[], path: string): Notebook | null => {
    for (const nb of nbs) {
      if (nb.path === path) return nb;
      const found = findNotebookByPath(nb.children, path);
      if (found) return found;
    }
    return null;
  };

  // Expand all parent folders in the path to a notebook
  const expandPathToNotebook = async (targetPath: string) => {
    if (!notesDir) return;
    
    // Get the relative path from notesDir
    const relativePath = targetPath.startsWith(notesDir) 
      ? targetPath.slice(notesDir.length + 1) 
      : targetPath;
    
    // Split into path segments
    const segments = relativePath.split('/').filter(Boolean);
    
    // Build up each parent path and expand it
    let currentPath = notesDir;
    const foldersToExpand: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      currentPath = `${currentPath}/${segments[i]}`;
      const notebook = findNotebookByPath(notebooks, currentPath);
      if (notebook) {
        foldersToExpand.push(notebook.id);
        // Load children if not already loaded
        if (!hasRealChildren(notebook) && isExpandable(notebook)) {
          try {
            const children = await invoke<Notebook[]>('list_notebooks', { basePath: notebook.path });
            setNotebooks(prev => updateNotebookChildren(prev, notebook.path, children));
          } catch (e) {
            console.error('Failed to load children:', e);
          }
        }
      }
    }
    
    // Expand all folders in the path
    setExpandedFolders(prev => {
      const next = new Set(prev);
      foldersToExpand.forEach(id => next.add(id));
      return next;
    });
  };

  // Favorites
  const toggleFavorite = async () => {
    if (!selectedNote || !notesDir) return;
    const notePath = `${selectedNote.folder}/${selectedNote.id}`;
    try {
      const newSettings = await invoke<AppSettings>('toggle_favorite', { basePath: notesDir, notePath });
      setFavorites(newSettings.favorites);
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  const isFavorite = selectedNote ? favorites.includes(`${selectedNote.folder}/${selectedNote.id}`) : false;

  // Tags
  const addTag = async () => {
    if (!newTag.trim() || !selectedNote || !notesDir) return;
    const notePath = `${selectedNote.folder}/${selectedNote.id}`;
    const updatedTags = [...noteTags, newTag.trim()];
    try {
      await invoke('set_note_tags', { basePath: notesDir, notePath, tags: updatedTags });
      setNoteTags(updatedTags);
      if (!allTags.includes(newTag.trim())) {
        setAllTags([...allTags, newTag.trim()].sort());
      }
      setNewTag('');
      setShowTagInput(false);
    } catch (e) {
      console.error('Failed to add tag:', e);
    }
  };

  const removeTag = async (tag: string) => {
    if (!selectedNote || !notesDir) return;
    const notePath = `${selectedNote.folder}/${selectedNote.id}`;
    const updatedTags = noteTags.filter(t => t !== tag);
    try {
      await invoke('set_note_tags', { basePath: notesDir, notePath, tags: updatedTags });
      setNoteTags(updatedTags);
    } catch (e) {
      console.error('Failed to remove tag:', e);
    }
  };

  // Settings
  const updateFontSize = async (size: number) => {
    if (!settings || !notesDir) return;
    const newSettings = { ...settings, font_size: size };
    setSettings(newSettings);
    await invoke('save_settings', { basePath: notesDir, settings: newSettings });
  };

  const updateUiFontSize = async (size: number) => {
    if (!settings || !notesDir) return;
    const newSettings = { ...settings, ui_font_size: size };
    setSettings(newSettings);
    
    // Apply immediately to body
    document.body.style.fontSize = `${size}px`;
    document.documentElement.style.setProperty('--ui-font-size', `${size}px`);
    
    await invoke('save_settings', { basePath: notesDir, settings: newSettings });
  };

  const updateFontFamily = (family: string) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings || !notesDir) return;
    
    // Update ref directly without triggering re-render
    settingsRef.current = { ...currentSettings, font_family: family };
    
    // Apply immediately
    document.documentElement.style.setProperty('--editor-font-family', family);
    
    if (fontSaveTimerRef.current) clearTimeout(fontSaveTimerRef.current);
    fontSaveTimerRef.current = setTimeout(() => {
      invoke('save_settings', { basePath: notesDir, settings: settingsRef.current! });
      // Sync state after save
      setSettings(settingsRef.current);
    }, 500);
  };

  const updateUiFontFamily = (family: string) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings || !notesDir) return;
    
    console.log('updateUiFontFamily called with:', JSON.stringify(family));
    
    // Update ref directly without triggering re-render
    settingsRef.current = { ...currentSettings, ui_font_family: family };
    
    // Apply immediately to body using setProperty which handles quotes better
    document.body.style.setProperty('font-family', family);
    document.documentElement.style.setProperty('--ui-font-family', family);
    
    console.log('Body font-family is now:', getComputedStyle(document.body).fontFamily);
    
    if (fontSaveTimerRef.current) clearTimeout(fontSaveTimerRef.current);
    fontSaveTimerRef.current = setTimeout(() => {
      invoke('save_settings', { basePath: notesDir, settings: settingsRef.current! });
      // Sync state after save
      setSettings(settingsRef.current);
    }, 500);
  };

  // Helper to check if notebook has real children loaded (not just placeholder)
  const hasRealChildren = (notebook: Notebook): boolean => {
    return notebook.children.length > 0 && notebook.children[0].id !== '';
  };

  // Helper to check if notebook is expandable (has placeholder or real children)
  const isExpandable = (notebook: Notebook): boolean => {
    return notebook.children.length > 0;
  };

  // Update a notebook's children in the tree
  const updateNotebookChildren = (notebooks: Notebook[], targetPath: string, children: Notebook[]): Notebook[] => {
    return notebooks.map(nb => {
      if (nb.path === targetPath) {
        return { ...nb, children };
      }
      if (nb.children.length > 0) {
        return { ...nb, children: updateNotebookChildren(nb.children, targetPath, children) };
      }
      return nb;
    });
  };

  const toggleFolder = async (notebook: Notebook) => {
    const isExpanded = expandedFolders.has(notebook.id);
    
    if (isExpanded) {
      // Collapse
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.delete(notebook.id);
        return next;
      });
    } else {
      // Expand - fetch children if not already loaded
      if (!hasRealChildren(notebook) && isExpandable(notebook)) {
        setLoadingFolders(prev => new Set(prev).add(notebook.id));
        try {
          const children = await invoke<Notebook[]>('list_notebooks', { basePath: notebook.path });
          setNotebooks(prev => updateNotebookChildren(prev, notebook.path, children));
        } catch (e) {
          console.error('Failed to load children:', e);
        } finally {
          setLoadingFolders(prev => {
            const next = new Set(prev);
            next.delete(notebook.id);
            return next;
          });
        }
      }
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.add(notebook.id);
        return next;
      });
    }
  };

  // Move notebook to another location
  const moveNotebook = async (sourceNotebook: Notebook, targetNotebook: Notebook | null) => {
    if (!sourceNotebook || sourceNotebook.id === targetNotebook?.id) return;
    
    // Prevent moving a folder into itself or its children
    const isDescendant = (parent: Notebook, childPath: string): boolean => {
      if (parent.path === childPath) return true;
      return parent.children.some(c => isDescendant(c, childPath));
    };
    
    if (targetNotebook && isDescendant(sourceNotebook, targetNotebook.path)) {
      alert("Cannot move a folder into itself or its subfolder");
      return;
    }
    
    try {
      const targetPath = targetNotebook ? targetNotebook.path : notesDir;
      await invoke('move_notebook', { 
        sourcePath: sourceNotebook.path, 
        targetPath: targetPath 
      });
      // Refresh notebooks list
      const nbs = await invoke<Notebook[]>('list_notebooks', { basePath: notesDir });
      setNotebooks(nbs);
    } catch (e) {
      console.error('Failed to move notebook:', e);
      alert(`Failed to move notebook: ${e}`);
    }
  };

  // Move note to another folder
  const moveNote = async (note: Note, targetNotebook: Notebook | null) => {
    const targetPath = targetNotebook ? targetNotebook.path : notesDir;
    
    // Don't move if already in the same folder
    if (note.folder === targetPath) return;
    
    try {
      await invoke('move_note', { 
        sourceFolder: note.folder, 
        targetFolder: targetPath,
        noteId: note.id
      });
      
      // Remove from current notes list
      setNotes(prev => prev.filter(n => n.id !== note.id));
      
      // Close tab if open
      const tab = openTabs.find(t => t.note.id === note.id && t.note.folder === note.folder);
      if (tab) {
        closeTab(note.id);
      }
      
      // If we moved to the currently selected notebook, refresh its notes
      if (selectedNotebook?.path === targetPath) {
        const notesList = await invoke<Note[]>('list_notes', { notebookPath: targetPath });
        setNotes(notesList);
      }
    } catch (e) {
      console.error('Failed to move note:', e);
      alert(`Failed to move note: ${e}`);
    }
  };

  const renderNotebookItem = (notebook: Notebook, depth = 0): React.ReactNode => {
    const hasChildren = isExpandable(notebook);
    const isExpanded = expandedFolders.has(notebook.id);
    const isSelected = selectedNotebook?.id === notebook.id;
    const isDragging = draggedNotebook?.id === notebook.id;
    const isDropTargetItem = dropTarget === notebook.id;
    const isLoading = loadingFolders.has(notebook.id);
    const style = getNotebookStyle(notebook.path);
    const childrenLoaded = hasRealChildren(notebook);

    return (
      <React.Fragment key={`${notebook.id}-${depth}`}>
        <li
          className={`notebook-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDropTargetItem ? 'drop-target' : ''}`}
          style={{ paddingLeft: `${8 + depth * 12}px`, color: style.color }}
          onClick={() => setSelectedNotebook(notebook)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, notebook, inFavorites: false });
          }}
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', notebook.id);
            setDraggedNotebook(notebook);
          }}
          onDragEnd={() => {
            setDraggedNotebook(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if ((draggedNotebook && draggedNotebook.id !== notebook.id) || draggedNote) {
              setDropTarget(notebook.id);
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if ((draggedNotebook && draggedNotebook.id !== notebook.id) || draggedNote) {
              setDropTarget(notebook.id);
            }
          }}
          onDragLeave={(e) => {
            const relatedTarget = e.relatedTarget as HTMLElement;
            if (!e.currentTarget.contains(relatedTarget)) {
              setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedNotebook && draggedNotebook.id !== notebook.id) {
              moveNotebook(draggedNotebook, notebook);
            }
            if (draggedNote) {
              moveNote(draggedNote, notebook);
            }
            setDraggedNotebook(null);
            setDraggedNote(null);
            setDropTarget(null);
          }}
        >
          {hasChildren && (
            <span 
              className={`folder-toggle ${isLoading ? 'loading' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleFolder(notebook); }}
              onDragStart={(e) => e.preventDefault()}
            >
              {isLoading ? <span className="spinner" /> : (isExpanded ? '▼' : '▶')}
            </span>
          )}
          {!hasChildren && <span className="folder-toggle-placeholder" />}
          <span className="notebook-icon">{style.icon}</span>
          <span className="notebook-name">{notebook.name}</span>
        </li>
        {hasChildren && isExpanded && childrenLoaded && (
          <ul className="nested-notebooks">
            {notebook.children.map((child) => renderNotebookItem(child, depth + 1))}
          </ul>
        )}
      </React.Fragment>
    );
  };

  const importFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: 'Select folder to import as notebook' });
      if (selected && typeof selected === 'string') {
        const nb = await invoke<Notebook>('import_folder', { basePath: notesDir, folderPath: selected });
        setNotebooks([...notebooks, nb]);
        setSelectedNotebook(nb);
      }
    } catch (err) {
      console.error('Failed to import folder:', err);
    }
  };

  const createNotebook = async () => {
    if (!newNotebookName.trim()) return;
    try {
      const nb = await invoke<Notebook>('create_notebook', { basePath: notesDir, name: newNotebookName.trim() });
      setNotebooks([...notebooks, nb]);
      setNewNotebookName('');
      setShowNewNotebook(false);
    } catch (e) {
      console.error('Failed to create notebook:', e);
    }
  };

  const createNote = async () => {
    const notebookPath = selectedNotebook?.path || notesDir;
    if (!notebookPath || !newNoteName.trim()) return;
    
    // Sanitize filename: remove invalid characters
    const safeName = newNoteName.trim().replace(/[<>:"/\\|?*]/g, '-');
    const noteId = `${safeName}.md`;
    
    const newNote: Note = {
      id: noteId,
      title: safeName,
      content: `# ${safeName}\n\n`,
      folder: notebookPath,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      await invoke('save_note', { notebookPath, noteId, content: newNote.content });
      setNotes([...notes, newNote]);
      openNoteInTab(newNote);
      setNewNoteName('');
      setShowNewNote(false);
    } catch (e) {
      console.error('Failed to create note:', e);
    }
  };

  const isEditableFile = (noteId: string) => {
    const ext = noteId.split('.').pop()?.toLowerCase() || '';
    const textExtensions = [
      'md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'log',
      'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config',
      'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp', 'h', 'hpp',
      'go', 'rb', 'php', 'swift', 'kt', 'scala', 'cs', 'fs', 'vb',
      'lua', 'pl', 'pm', 'r', 'm', 'mm', 'sql', 'sh', 'bash', 'zsh',
      'fish', 'ps1', 'psm1', 'bat', 'cmd',
      'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'xsl', 'xslt',
      'vue', 'svelte', 'csv', 'tsv',
      'pem', 'crt', 'cer', 'key', 'pub',
      'rst', 'adoc', 'asciidoc', 'org', 'tex', 'latex',
      'env', 'gitignore', 'dockerignore', 'editorconfig', 'prettierrc',
      'eslintrc', 'babelrc', 'nvmrc', 'npmrc', 'yarnrc',
      'makefile', 'cmake', 'gradle', 'properties',
    ];
    return textExtensions.includes(ext) || !noteId.includes('.');
  };

  const isPdfFile = (noteId: string, noteContent?: string) => {
    const ext = noteId.split('.').pop()?.toLowerCase() || '';
    // Check extension
    if (ext === 'pdf') return true;
    // Check if filename contains 'pdf' (for files like meal_plan_pdf without extension)
    if (noteId.toLowerCase().includes('pdf')) return true;
    // Fallback: check if content contains an iframe with asset:// (PDF from backend)
    if (noteContent && noteContent.includes('<iframe') && noteContent.includes('asset://')) {
      return true;
    }
    return false;
  };

  const isDocxFile = (noteId: string) => {
    const ext = noteId.split('.').pop()?.toLowerCase() || '';
    return ext === 'docx';
  };

  const isExcelFile = (noteId: string) => {
    const ext = noteId.split('.').pop()?.toLowerCase() || '';
    return ['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext);
  };

  const isPptxFile = (noteId: string) => {
    const ext = noteId.split('.').pop()?.toLowerCase() || '';
    return ['pptx', 'ppt'].includes(ext);
  };

  const isOfficeFile = (noteId: string) => isDocxFile(noteId) || isExcelFile(noteId) || isPptxFile(noteId);

  // Office preview refs and state
  const officeContainerRef = useRef<HTMLDivElement>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);

  // Load office file preview when selected
  useEffect(() => {
    const loadOfficePreview = async () => {
      if (!selectedNote || !officeContainerRef.current) return;
      
      const noteId = selectedNote.id;
      if (!isOfficeFile(noteId)) return;
      
      setOfficeLoading(true);
      setExcelSheets([]);
      setActiveSheet('');
      setExcelWorkbook(null);
      
      try {
        const filePath = `${selectedNote.folder}/${selectedNote.id}`;
        const fileBytes = await invoke<number[]>('read_file_binary', { filePath });
        const uint8Array = new Uint8Array(fileBytes);
        
        officeContainerRef.current.innerHTML = '';
        
        if (isDocxFile(noteId)) {
          const blob = new Blob([uint8Array], { 
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
          });
          await renderAsync(blob, officeContainerRef.current, undefined, {
            className: 'docx-preview-content',
            inWrapper: false,
            ignoreWidth: true,
            ignoreHeight: true,
            ignoreFonts: true,
            breakPages: false,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            renderHeaders: false,
            renderFooters: false,
            renderFootnotes: false,
            renderEndnotes: false,
          });
        } else if (isExcelFile(noteId)) {
          const workbook = XLSX.read(uint8Array, { type: 'array' });
          setExcelWorkbook(workbook);
          setExcelSheets(workbook.SheetNames);
          setActiveSheet(workbook.SheetNames[0] || '');
        } else if (isPptxFile(noteId)) {
          // Basic PPTX parsing - extract text content from slides
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(uint8Array);
          
          const slides: { num: number; content: string }[] = [];
          const slideFiles = Object.keys(zip.files)
            .filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/))
            .sort((a, b) => {
              const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
              const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
              return numA - numB;
            });
          
          for (const slideFile of slideFiles) {
            const content = await zip.files[slideFile].async('text');
            // Extract text from XML
            const textMatches = content.match(/<a:t>([^<]*)<\/a:t>/g) || [];
            const texts = textMatches.map(m => m.replace(/<\/?a:t>/g, '')).filter(t => t.trim());
            const slideNum = parseInt(slideFile.match(/slide(\d+)/)?.[1] || '0');
            slides.push({ num: slideNum, content: texts.join('\n') });
          }
          
          officeContainerRef.current.innerHTML = slides.map(s => `
            <div class="pptx-slide">
              <div class="pptx-slide-header">Slide ${s.num}</div>
              <div class="pptx-slide-content">${s.content.split('\n').map(l => `<p>${l}</p>`).join('')}</div>
            </div>
          `).join('') || '<div class="office-empty">No slides found</div>';
        }
      } catch (e) {
        console.error('Failed to load office preview:', e);
        if (officeContainerRef.current) {
          officeContainerRef.current.innerHTML = `<div class="office-error">Failed to load preview: ${e}</div>`;
        }
      } finally {
        setOfficeLoading(false);
      }
    };
    
    loadOfficePreview();
  }, [selectedNote]);

  // Render Excel sheet when active sheet changes
  useEffect(() => {
    if (!excelWorkbook || !activeSheet || !officeContainerRef.current) return;
    
    const worksheet = excelWorkbook.Sheets[activeSheet];
    const html = XLSX.utils.sheet_to_html(worksheet, { editable: false });
    officeContainerRef.current.innerHTML = html;
  }, [excelWorkbook, activeSheet]);

  const saveNote = async () => {
    const notebookPath = selectedNotebook?.path || notesDir;
    if (!selectedNote || !notebookPath) return;
    setIsSaving(true);
    setSaveIndicator('saving');
    try {
      await invoke('save_note', { notebookPath, noteId: selectedNote.id, content });
      const title = content.split('\n')[0].replace(/^#\s*/, '') || 'Untitled';
      const updatedNote = { ...selectedNote, content, title, updated_at: new Date().toISOString() };
      setSelectedNote(updatedNote);
      
      // Refresh the notes list to pick up any new files (e.g., pasted images)
      const notesList = await invoke<Note[]>('list_notes', { notebookPath });
      setNotes(notesList);
      
      // Update tab to mark as not dirty
      setOpenTabs(prev => prev.map(t => 
        t.note.id === selectedNote.id ? { ...t, note: updatedNote, content, isDirty: false } : t
      ));
      setSaveIndicator('saved');
      setTimeout(() => setSaveIndicator('idle'), 2000);
    } catch (e) {
      console.error('Failed to save note:', e);
      setSaveIndicator('idle');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteNote = async () => {
    const notebookPath = selectedNotebook?.path || notesDir;
    if (!selectedNote || !notebookPath) return;
    if (!confirm('Delete this note?')) return;
    try {
      await invoke('delete_note', { notebookPath, noteId: selectedNote.id });
      setNotes(notes.filter(n => n.id !== selectedNote.id));
      // Close the tab for deleted note
      closeTab(selectedNote.id);
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (!selectedNote || !selectedNotebook) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const fileName = `image_${Date.now()}.png`;
          try {
            const path = await invoke<string>('save_attachment', {
              notebookPath: selectedNotebook.path, noteId: selectedNote.id, fileName, data: base64,
            });
            setContent(prev => prev + `\n![${fileName}](${path})\n`);
          } catch (err) {
            console.error('Failed to save image:', err);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!selectedNote || !selectedNotebook) return;
    const files = e.dataTransfer.files;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        try {
          const path = await invoke<string>('save_attachment', {
            notebookPath: selectedNotebook.path, noteId: selectedNote.id, fileName: file.name, data: base64,
          });
          const isImage = file.type.startsWith('image/');
          const markdown = isImage ? `\n![${file.name}](${path})\n` : `\n[${file.name}](${path})\n`;
          setContent(prev => prev + markdown);
        } catch (err) {
          console.error('Failed to save attachment:', err);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle image insertion via file dialog
  const handleInsertImage = async () => {
    if (!selectedNote || !selectedNotebook) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
        }]
      });
      console.log('Selected file:', selected);
      if (selected && typeof selected === 'string') {
        // Read the file and save as attachment
        const { readFile: readBinaryFile } = await import('@tauri-apps/plugin-fs');
        const fileData = await readBinaryFile(selected);
        console.log('File data length:', fileData.length);
        
        // Convert Uint8Array to base64 properly
        let binary = '';
        const bytes = new Uint8Array(fileData);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        console.log('Base64 length:', base64.length);
        
        const fileName = selected.split('/').pop() || `image_${Date.now()}.png`;
        console.log('Saving attachment:', { notebookPath: selectedNotebook.path, noteId: selectedNote.id, fileName });
        const path = await invoke<string>('save_attachment', {
          notebookPath: selectedNotebook.path, noteId: selectedNote.id, fileName, data: base64,
        });
        console.log('Saved attachment path:', path);
        setContent(prev => prev + `\n![${fileName}](${path})\n`);
      }
    } catch (err) {
      console.error('Failed to insert image:', err);
    }
  };

  // Custom image command for MDEditor
  const imageCommand = {
    ...commands.image,
    execute: () => {
      handleInsertImage();
    },
  };

  // Sync
  const performSync = async () => {
    if (!syncConfig || !notesDir) return;
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    try {
      let result: SyncStatus;
      const creds = syncConfig.credentials;
      
      switch (syncConfig.provider) {
        case 's3':
          result = await invoke<SyncStatus>('sync_to_s3', {
            bucket: creds.bucket, region: creds.region,
            accessKey: creds.accessKey, secretKey: creds.secretKey, notesPath: notesDir,
          });
          break;
        case 'dropbox':
          result = await invoke<SyncStatus>('sync_to_dropbox', { accessToken: creds.accessToken, notesPath: notesDir });
          break;
        case 'onedrive':
          result = await invoke<SyncStatus>('sync_to_onedrive', { accessToken: creds.accessToken, notesPath: notesDir });
          break;
        case 'googledrive':
          result = await invoke<SyncStatus>('sync_to_google_drive', { accessToken: creds.accessToken, notesPath: notesDir });
          break;
        default:
          throw new Error('Unknown provider');
      }
      
      setSyncStatus(result.message);
      if (result.conflicts.length > 0) {
        alert(`Sync completed with ${result.conflicts.length} conflicts. Please resolve them.`);
      }
      
      // Update last sync time
      const updatedConfig = { ...syncConfig, last_sync: new Date().toISOString() };
      await invoke('save_sync_config', { basePath: notesDir, config: updatedConfig });
      setSyncConfig(updatedConfig);
    } catch (e) {
      setSyncStatus(`Sync failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const SearchModal = () => (
    <div className="modal-overlay" onClick={() => setShowSearch(false)}>
      <div className="modal search-modal" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          type="text"
          placeholder="Search all notes..."
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          className="search-input"
        />
        <div className="search-results">
          {searchResults.map((result, i) => (
            <div key={i} className="search-result" onClick={() => selectSearchResult(result)}>
              <div className="search-result-title">{result.note_title}</div>
              <div className="search-result-path">{result.notebook_name}</div>
              <div className="search-result-snippet">{result.snippet}</div>
            </div>
          ))}
          {searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="search-empty">No results found</div>
          )}
        </div>
      </div>
    </div>
  );

  // Command palette
  interface PaletteCommand {
    id: string;
    label: string;
    shortcut?: string;
    icon: string;
    action: () => void;
    category: string;
  }

  const paletteCommands: PaletteCommand[] = [
    // File commands
    { id: 'new-note', label: 'New Note', shortcut: '', icon: '📝', category: 'File', action: () => { setShowCommandPalette(false); setShowNewNote(true); } },
    { id: 'new-notebook', label: 'New Notebook', shortcut: '', icon: '📁', category: 'File', action: () => { setShowCommandPalette(false); setShowNewNotebook(true); } },
    { id: 'save', label: 'Save Note', shortcut: '⌘S', icon: '💾', category: 'File', action: () => { setShowCommandPalette(false); if (selectedNote && isEditableFile(selectedNote.id)) saveNote(); } },
    { id: 'import-folder', label: 'Import Folder as Notebook', shortcut: '', icon: '📂', category: 'File', action: () => { setShowCommandPalette(false); importFolder(); } },
    
    // Navigation commands
    { id: 'search', label: 'Search Notes', shortcut: '⌘K', icon: '🔍', category: 'Navigation', action: () => { setShowCommandPalette(false); setShowSearch(true); } },
    { id: 'go-to-favorites', label: 'Go to Favorites', shortcut: '', icon: '⭐', category: 'Navigation', action: () => { setShowCommandPalette(false); setSelectedNotebook(null); setFilterTag(null); } },
    
    // Edit commands
    { id: 'toggle-favorite', label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites', shortcut: '', icon: isFavorite ? '★' : '☆', category: 'Edit', action: () => { setShowCommandPalette(false); toggleFavorite(); } },
    { id: 'add-tag', label: 'Add Tag to Note', shortcut: '', icon: '🏷️', category: 'Edit', action: () => { setShowCommandPalette(false); setShowTagInput(true); } },
    { id: 'delete-note', label: 'Delete Note', shortcut: '', icon: '🗑️', category: 'Edit', action: () => { setShowCommandPalette(false); deleteNote(); } },
    
    // View commands
    { id: 'sort-name', label: 'Sort by Name', shortcut: '', icon: '🔤', category: 'View', action: () => { setShowCommandPalette(false); setSortBy('name'); } },
    { id: 'sort-updated', label: 'Sort by Modified Date', shortcut: '', icon: '📅', category: 'View', action: () => { setShowCommandPalette(false); setSortBy('updated'); } },
    { id: 'sort-created', label: 'Sort by Created Date', shortcut: '', icon: '📆', category: 'View', action: () => { setShowCommandPalette(false); setSortBy('created'); } },
    { id: 'toggle-sort-order', label: sortOrder === 'asc' ? 'Sort Descending' : 'Sort Ascending', shortcut: '', icon: sortOrder === 'asc' ? '↓' : '↑', category: 'View', action: () => { setShowCommandPalette(false); toggleSortOrder(); } },
    
    // Sync commands
    ...(syncConfig ? [{ id: 'sync', label: 'Sync Now', shortcut: '', icon: '☁️', category: 'Sync', action: () => { setShowCommandPalette(false); performSync(); } }] : []),
    
    // Settings commands
    { id: 'settings', label: 'Open Settings', shortcut: '⌘,', icon: '⚙️', category: 'Settings', action: () => { setShowCommandPalette(false); setShowSettings(true); } },
    { id: 'help', label: 'Open Help', shortcut: '⌘?', icon: '❓', category: 'Settings', action: () => { setShowCommandPalette(false); setShowHelp(true); } },
    { id: 'toggle-autosave', label: settings?.auto_save ? 'Disable Auto-Save' : 'Enable Auto-Save', shortcut: '', icon: settings?.auto_save ? '🔴' : '🟢', category: 'Settings', action: async () => { 
      setShowCommandPalette(false); 
      if (settings && notesDir) {
        const newSettings = { ...settings, auto_save: !settings.auto_save };
        setSettings(newSettings);
        await invoke('save_settings', { basePath: notesDir, settings: newSettings });
      }
    } },
  ];

  const filteredCommands = paletteCommands.filter(cmd => {
    if (!commandQuery) return true;
    const query = commandQuery.toLowerCase();
    return cmd.label.toLowerCase().includes(query) || 
           cmd.category.toLowerCase().includes(query);
  });

  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  const handleCommandKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedCommandIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedCommandIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedCommandIndex]) {
        filteredCommands[selectedCommandIndex].action();
      }
    } else if (e.key === 'Escape') {
      setShowCommandPalette(false);
      setCommandQuery('');
    }
  };

  const CommandPalette = () => (
    <div className="modal-overlay" onClick={() => { setShowCommandPalette(false); setCommandQuery(''); }}>
      <div className="modal command-palette" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          type="text"
          placeholder="Type a command..."
          value={commandQuery}
          onChange={e => setCommandQuery(e.target.value)}
          onKeyDown={handleCommandKeyDown}
          className="command-input"
        />
        <div className="command-list">
          {filteredCommands.map((cmd, i) => (
            <div 
              key={cmd.id} 
              className={`command-item ${i === selectedCommandIndex ? 'selected' : ''}`}
              onClick={() => cmd.action()}
            >
              <span className="command-icon">{cmd.icon}</span>
              <span className="command-label">{cmd.label}</span>
              <span className="command-category">{cmd.category}</span>
              {cmd.shortcut && <span className="command-shortcut">{cmd.shortcut}</span>}
            </div>
          ))}
          {filteredCommands.length === 0 && (
            <div className="command-empty">No commands found</div>
          )}
        </div>
      </div>
    </div>
  );

  const NotebookCustomizeModal = () => {
    if (!customizingNotebook) return null;
    const currentStyle = getNotebookStyle(customizingNotebook.path);
    
    return (
      <div className="modal-overlay" onClick={() => setCustomizingNotebook(null)}>
        <div className="modal notebook-customize-modal" onClick={e => e.stopPropagation()}>
          <h2>Customize "{customizingNotebook.name}"</h2>
          
          <div className="customize-section">
            <label>Icon</label>
            <div className="icon-grid">
              {notebookIcons.map(icon => (
                <button
                  key={icon}
                  className={`icon-option ${currentStyle.icon === icon ? 'selected' : ''}`}
                  onClick={() => updateNotebookStyle(customizingNotebook.path, { icon })}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          
          <div className="customize-section">
            <label>Color</label>
            <div className="color-grid">
              {notebookColors.map(color => (
                <button
                  key={color}
                  className={`color-option ${currentStyle.color === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => updateNotebookStyle(customizingNotebook.path, { color })}
                />
              ))}
            </div>
          </div>
          
          <div className="customize-preview">
            <span style={{ color: currentStyle.color }}>{currentStyle.icon} {customizingNotebook.name}</span>
          </div>
          
          <button className="close-btn" onClick={() => setCustomizingNotebook(null)}>Done</button>
        </div>
      </div>
    );
  };

  const NotebookContextMenu = () => {
    if (!contextMenu) return null;
    
    const handleRemoveFromFavorites = async () => {
      if (contextMenu.notebook) {
        // Remove pinned folder
        togglePin(contextMenu.notebook.path);
      } else if (contextMenu.notePath) {
        // Remove favorite note
        toggleFavoriteByPath(contextMenu.notePath);
      }
      setContextMenu(null);
    };
    
    const handlePin = () => {
      if (contextMenu.notebook) {
        togglePin(contextMenu.notebook.path);
      }
      setContextMenu(null);
    };
    
    const handleCustomize = () => {
      if (contextMenu.notebook) {
        setCustomizingNotebook(contextMenu.notebook);
      }
      setContextMenu(null);
    };
    
    const handleRenameNote = () => {
      if (contextMenu.note) {
        setRenamingNote(contextMenu.note);
        setRenameValue(contextMenu.note.id);
      }
      setContextMenu(null);
    };
    
    const handleDeleteNote = async () => {
      const noteToDelete = contextMenu.note;
      const notebookPath = selectedNotebook?.path;
      
      if (!noteToDelete || !notebookPath) {
        setContextMenu(null);
        return;
      }
      
      // Close context menu first
      setContextMenu(null);
      
      // Use Tauri's native confirm dialog
      const { ask } = await import('@tauri-apps/plugin-dialog');
      const confirmed = await ask(`Delete "${noteToDelete.title}"?`, {
        title: 'Confirm Delete',
        kind: 'warning',
      });
      
      if (!confirmed) {
        return;
      }
      
      try {
        await invoke('delete_note', { notebookPath, noteId: noteToDelete.id });
        // Refresh notes list
        const notesList = await invoke<Note[]>('list_notes', { notebookPath });
        setNotes(notesList);
        // Close tab if open
        if (openTabs.some(t => t.note.id === noteToDelete.id)) {
          closeTab(noteToDelete.id);
        }
      } catch (e) {
        console.error('Failed to delete note:', e);
        alert(`Failed to delete: ${e}`);
      }
    };
    
    // Context menu for notes in the notes list
    if (contextMenu.note) {
      return (
        <div className="context-menu-overlay" onClick={() => setContextMenu(null)}>
          <div 
            className="context-menu" 
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={handleRenameNote}>
              ✏️ Rename
            </button>
            <button onClick={handleDeleteNote}>
              🗑️ Delete
            </button>
          </div>
        </div>
      );
    }
    
    // Show different menu based on context
    if (contextMenu.inFavorites) {
      return (
        <div className="context-menu-overlay" onClick={() => setContextMenu(null)}>
          <div 
            className="context-menu" 
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={handleRemoveFromFavorites}>
              ✕ Remove from Favorites
            </button>
          </div>
        </div>
      );
    }
    
    return (
      <div className="context-menu-overlay" onClick={() => setContextMenu(null)}>
        <div 
          className="context-menu" 
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={handlePin}>
            {contextMenu.notebook && isPinned(contextMenu.notebook.path) ? '✕ Remove from Favorites' : '⭐ Add to Favorites'}
          </button>
          <button onClick={handleCustomize}>
            🎨 Customize
          </button>
        </div>
      </div>
    );
  };

  const changeNotesDirectory = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ 
        directory: true, 
        title: 'Select Notes Directory',
        defaultPath: notesDir 
      });
      if (selected && typeof selected === 'string') {
        // Show loading state and close modal
        setIsChangingDirectory(true);
        setShowSettings(false);
        
        // Reset state
        setSelectedNotebook(null);
        setSelectedNote(null);
        setContent('');
        setOpenTabs([]);
        setActiveTabId(null);
        setNotebooks([]);
        setNotesDir(selected);
        
        // Store for completion handler
        pendingInitRef.current = { dir: selected };
        
        // Fire and forget - don't await anything
        invoke('set_notes_dir', { path: selected }).catch(e => console.error('set_notes_dir error:', e));
        invoke('list_notebooks_async', { basePath: selected }).catch(e => console.error('list_notebooks_async error:', e));
      }
    } catch (err) {
      console.error('Failed to change notes directory:', err);
      setIsChangingDirectory(false);
    }
  };

  const settingsModalContent = showSettings ? (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <h2>Settings</h2>
        
        <div className="settings-section">
          <label>Notes Directory</label>
          <div className="notes-dir-setting">
            <code className="current-dir">{notesDir}</code>
            <button onClick={changeNotesDirectory}>Change...</button>
          </div>
        </div>
        
        <div className="settings-section">
          <label>Font Size</label>
          <input
            type="range"
            min="10"
            max="24"
            value={settings?.font_size || 14}
            onChange={e => updateFontSize(parseInt(e.target.value))}
          />
          <span>{settings?.font_size || 14}px</span>
        </div>
        <div className="settings-section">
          <label>Editor Font Family</label>
          <input
            type="text"
            value={localEditorFont}
            onChange={e => setLocalEditorFont(e.target.value)}
            onBlur={e => updateFontFamily(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') updateFontFamily(e.currentTarget.value); }}
            placeholder="e.g. 'Fira Code', 'JetBrains Mono', monospace"
          />
        </div>
        <div className="settings-section">
          <label>UI Font Family</label>
          <input
            type="text"
            value={localUiFont}
            onChange={e => setLocalUiFont(e.target.value)}
            onBlur={e => updateUiFontFamily(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') updateUiFontFamily(e.currentTarget.value); }}
            placeholder="e.g. system-ui, 'Inter', sans-serif"
          />
        </div>
        <div className="settings-section">
          <label>UI Font Size</label>
          <input
            type="range"
            min="10"
            max="18"
            value={settings?.ui_font_size || 13}
            onChange={e => updateUiFontSize(parseInt(e.target.value))}
          />
          <span>{settings?.ui_font_size || 13}px</span>
        </div>
        
        {/* Cloud Sync Section */}
        <div className="settings-section">
          <label>Cloud Sync</label>
          <div className="sync-options">
            <button 
              className={syncConfig?.provider === 's3' ? 'active' : ''}
              onClick={() => setSyncConfig({ provider: 's3', enabled: true, credentials: syncConfig?.provider === 's3' ? syncConfig.credentials : {} })}
            >Amazon S3</button>
            <button 
              className={syncConfig?.provider === 'dropbox' ? 'active' : ''}
              onClick={() => setSyncConfig({ provider: 'dropbox', enabled: true, credentials: syncConfig?.provider === 'dropbox' ? syncConfig.credentials : {} })}
            >Dropbox</button>
            <button 
              className={syncConfig?.provider === 'onedrive' ? 'active' : ''}
              onClick={() => setSyncConfig({ provider: 'onedrive', enabled: true, credentials: syncConfig?.provider === 'onedrive' ? syncConfig.credentials : {} })}
            >OneDrive</button>
            <button 
              className={syncConfig?.provider === 'googledrive' ? 'active' : ''}
              onClick={() => setSyncConfig({ provider: 'googledrive', enabled: true, credentials: syncConfig?.provider === 'googledrive' ? syncConfig.credentials : {} })}
            >Google Drive</button>
          </div>
          {syncConfig && (
            <div className="sync-config">
              {syncConfig.provider === 's3' && (
                <>
                  <input placeholder="Bucket Name" value={syncConfig.credentials.bucket || ''} onChange={e => setSyncConfig({
                    ...syncConfig, credentials: { ...syncConfig.credentials, bucket: e.target.value }
                  })} />
                  <input placeholder="Region" value={syncConfig.credentials.region || ''} onChange={e => setSyncConfig({
                    ...syncConfig, credentials: { ...syncConfig.credentials, region: e.target.value }
                  })} />
                  <input placeholder="Access Key" type="password" value={syncConfig.credentials.accessKey || ''} onChange={e => setSyncConfig({
                    ...syncConfig, credentials: { ...syncConfig.credentials, accessKey: e.target.value }
                  })} />
                  <input placeholder="Secret Key" type="password" value={syncConfig.credentials.secretKey || ''} onChange={e => setSyncConfig({
                    ...syncConfig, credentials: { ...syncConfig.credentials, secretKey: e.target.value }
                  })} />
                </>
              )}
              {(syncConfig.provider === 'dropbox' || syncConfig.provider === 'onedrive' || syncConfig.provider === 'googledrive') && (
                <input placeholder="Access Token" type="password" value={syncConfig.credentials.accessToken || ''} onChange={e => setSyncConfig({
                  ...syncConfig, credentials: { ...syncConfig.credentials, accessToken: e.target.value }
                })} />
              )}
              <button className="save-sync-btn" onClick={async () => {
                await invoke('save_sync_config', { basePath: notesDir, config: syncConfig });
              }}>Save Sync Configuration</button>
              {syncConfig.last_sync && <p className="last-sync">Last sync: {new Date(syncConfig.last_sync).toLocaleString()}</p>}
            </div>
          )}
        </div>
        
        <button className="close-btn" onClick={() => setShowSettings(false)}>Close</button>
      </div>
    </div>
  ) : null;

  const HelpModal = () => (
    <div className="modal-overlay" onClick={() => setShowHelp(false)}>
      <div className="modal help-modal" onClick={e => e.stopPropagation()}>
        <h2>Azimuth Help</h2>
        
        <div className="help-content">
          <section>
            <h3>Getting Started</h3>
            <p>Azimuth is a note-taking app that stores your notes as markdown files in a folder on your computer.</p>
            <p>Notes are organized in <strong>notebooks</strong> (folders) and can contain text, images, and attachments.</p>
          </section>
          
          <section>
            <h3>Keyboard Shortcuts</h3>
            <table className="help-table">
              <tbody>
                <tr><td><kbd>⌘S</kbd></td><td>Save note</td></tr>
                <tr><td><kbd>⌘K</kbd></td><td>Search all notes</td></tr>
                <tr><td><kbd>⌘P</kbd></td><td>Command palette</td></tr>
                <tr><td><kbd>⌘,</kbd></td><td>Open Settings</td></tr>
                <tr><td><kbd>⌘?</kbd></td><td>Open Help</td></tr>
              </tbody>
            </table>
          </section>
          
          <section>
            <h3>Quick Commands</h3>
            <p>Type these in the editor to auto-expand:</p>
            <table className="help-table">
              <tbody>
                <tr><td><code>:date</code></td><td>Current date and time (YYYY-MM-DD HH:MM)</td></tr>
                <tr><td><code>:today</code></td><td>Current date (YYYY-MM-DD)</td></tr>
                <tr><td><code>:time</code></td><td>Current time (HH:MM)</td></tr>
              </tbody>
            </table>
          </section>
          
          <section>
            <h3>Working with Notes</h3>
            <ul>
              <li><strong>Create a note:</strong> Click the + button in the Notes panel</li>
              <li><strong>Rename/Delete:</strong> Right-click a note in the list</li>
              <li><strong>Add images:</strong> Click the image icon in the toolbar, or paste/drag images</li>
              <li><strong>Favorite a note:</strong> Click the ☆ button in the toolbar</li>
              <li><strong>Tag notes:</strong> Click "+ Tag" below the toolbar</li>
            </ul>
          </section>
          
          <section>
            <h3>Working with Notebooks</h3>
            <ul>
              <li><strong>Create a notebook:</strong> Click the + button in the Notebooks header</li>
              <li><strong>Import a folder:</strong> Click the 📁 button</li>
              <li><strong>Customize:</strong> Right-click a notebook → Customize (change icon/color)</li>
              <li><strong>Add to Favorites:</strong> Right-click a notebook → Add to Favorites</li>
              <li><strong>Move notebooks:</strong> Drag and drop to reorganize</li>
            </ul>
          </section>
          
          <section>
            <h3>Data Storage</h3>
            <p>Notes are stored in <code>~/Azimuth/</code> by default. You can change this in Settings.</p>
            <p>Each notebook is a folder, and notes are files within those folders.</p>
          </section>
        </div>
        
        <button className="close-btn" onClick={() => setShowHelp(false)}>Close</button>
      </div>
    </div>
  );

  // Apply UI font settings to document root
  useEffect(() => {
    if (settings) {
      const uiFont = settings.ui_font_family || "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const uiFontSize = `${settings.ui_font_size || 13}px`;
      document.documentElement.style.setProperty('--ui-font-family', uiFont);
      document.documentElement.style.setProperty('--ui-font-size', uiFontSize);
      document.documentElement.style.setProperty('--editor-font-family', settings.font_family || "'SF Mono', 'Fira Code', 'Consolas', monospace");
      document.documentElement.style.setProperty('--editor-font-size', `${settings.font_size || 14}px`);
      // Also set directly on body to ensure it applies
      document.body.style.fontFamily = uiFont;
      document.body.style.fontSize = uiFontSize;
    }
  }, [settings]);

  return (
    <div className="app">
      {isChangingDirectory && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner" />
            <p>Loading directory...</p>
          </div>
        </div>
      )}
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <label className="auto-save-toggle" title={settings?.auto_save ? 'Auto-save enabled' : 'Auto-save disabled'}>
            <input 
              type="checkbox" 
              checked={settings?.auto_save ?? true}
              onChange={async (e) => {
                if (settings && notesDir) {
                  const newSettings = { ...settings, auto_save: e.target.checked };
                  setSettings(newSettings);
                  await invoke('save_settings', { basePath: notesDir, settings: newSettings });
                }
              }}
            />
            <span className="toggle-slider"></span>
            <span className="toggle-label">Auto-save</span>
          </label>
          <div className="header-buttons">
            <button onClick={() => setShowSearch(true)} title="Search (Cmd+K)">🔍</button>
            <button onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
          </div>
        </div>
        
        {/* Tags filter */}
        {allTags.length > 0 && (
          <div className="tags-filter">
            <select value={filterTag || ''} onChange={e => setFilterTag(e.target.value || null)}>
              <option value="">All notes</option>
              {allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
            </select>
          </div>
        )}
        
        {/* Favorites (pinned folders + favorite notes) */}
        {(favorites.length > 0 || (settings?.pinned_folders?.length ?? 0) > 0) && (
          <div className="favorites-section">
            <div className="section-header"><span>⭐ Favorites</span></div>
            <ul>
              {/* Pinned folders first */}
              {settings?.pinned_folders?.map(pinnedPath => {
                const notebook = findNotebookByPath(notebooks, pinnedPath);
                if (!notebook) return null;
                const style = getNotebookStyle(notebook.path);
                return (
                  <li 
                    key={`folder-${pinnedPath}`} 
                    className={selectedNotebook?.path === pinnedPath ? 'selected' : ''}
                    onClick={() => {
                      // Expand all parent folders in the tree so the selection is visible
                      // Build list of parent paths from notesDir to the parent of pinnedPath
                      const relativePath = pinnedPath.startsWith(notesDir) 
                        ? pinnedPath.slice(notesDir.length + 1) 
                        : pinnedPath;
                      const pathParts = relativePath.split('/');
                      const foldersToExpand: string[] = [];
                      let currentPath = notesDir;
                      // Expand all ancestors (not the folder itself)
                      for (let i = 0; i < pathParts.length - 1; i++) {
                        currentPath = currentPath + '/' + pathParts[i];
                        foldersToExpand.push(currentPath);
                      }
                      if (foldersToExpand.length > 0) {
                        setExpandedFolders(prev => {
                          const next = new Set(prev);
                          foldersToExpand.forEach(id => next.add(id));
                          return next;
                        });
                      }
                      setSelectedNotebook(notebook);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, notebook, inFavorites: true });
                    }}
                  >
                    <span className="notebook-icon" style={{ color: style.color }}>{style.icon}</span>
                    <span style={{ color: style.color }}>{notebook.name}</span>
                  </li>
                );
              })}
              {/* Favorite notes */}
              {favorites.map(fav => {
                const parts = fav.split('/');
                const noteId = parts.pop() || '';
                const notebookPath = parts.join('/');
                return (
                  <li 
                    key={`note-${fav}`} 
                    onClick={async () => {
                      // Expand the directory tree to show the notebook
                      await expandPathToNotebook(notebookPath);
                      
                      const notebook = findNotebookByPath(notebooks, notebookPath);
                      if (notebook) {
                        setSelectedNotebook(notebook);
                        const notesList = await invoke<Note[]>('list_notes', { notebookPath });
                        setNotes(notesList);
                        const note = notesList.find(n => n.id === noteId);
                        if (note) { openNoteInTab(note); }
                      } else {
                        // Notebook not found in tree - try loading notes directly
                        try {
                          const notesList = await invoke<Note[]>('list_notes', { notebookPath });
                          setNotes(notesList);
                          const note = notesList.find(n => n.id === noteId);
                          if (note) { 
                            // Create a minimal notebook object for selection
                            const name = notebookPath.split('/').pop() || '';
                            setSelectedNotebook({ id: notebookPath, name, path: notebookPath, children: [] });
                            openNoteInTab(note); 
                          }
                        } catch (err) {
                          console.error('Failed to load notes:', err);
                        }
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, notePath: fav, inFavorites: true });
                    }}
                  >
                    📝 {noteId.replace(/\.[^/.]+$/, '')}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        
        <div 
          className={`notebooks ${dropTarget === 'root' ? 'drop-target' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedNotebook || draggedNote) {
              setDropTarget('root');
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (draggedNotebook || draggedNote) {
              setDropTarget('root');
            }
          }}
          onDragLeave={(e) => {
            const relatedTarget = e.relatedTarget as HTMLElement;
            if (!e.currentTarget.contains(relatedTarget)) {
              setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedNotebook) {
              moveNotebook(draggedNotebook, null);
            }
            if (draggedNote) {
              moveNote(draggedNote, null);
            }
            setDraggedNotebook(null);
            setDraggedNote(null);
            setDropTarget(null);
          }}
        >
          <div className="section-header">
            <span>Notebooks</span>
            <button onClick={() => setShowNewNotebook(true)} title="New notebook">+</button>
            <button onClick={importFolder} title="Import folder">📁</button>
          </div>
          {showNewNotebook && (
            <div className="new-notebook">
              <input value={newNotebookName} onChange={e => setNewNotebookName(e.target.value)}
                placeholder="Notebook name" onKeyDown={e => e.key === 'Enter' && createNotebook()} />
              <button onClick={createNotebook}>Create</button>
            </div>
          )}
          <ul>
            <li 
              className={`notebook-item ${selectedNotebook === null ? 'selected' : ''}`}
              onClick={() => setSelectedNotebook(null)}
            >
              <span className="notebook-icon">📂</span>
              <span className="notebook-name">/</span>
            </li>
            {notebooks.map((nb) => renderNotebookItem(nb, 0))}
          </ul>
        </div>
        <div className="resize-handle" onMouseDown={() => setIsResizingSidebar(true)} />
      </aside>
      
      {(selectedNotebook || notesDir) && (
        <aside className="notes-sidebar" style={{ width: notesWidth }}>
          <div className="notes-list">
            <div className="section-header">
              <span>{selectedNotebook ? 'Notes' : '/'}</span>
              <button onClick={() => setShowNewNote(true)}>+</button>
            </div>
            {showNewNote && (
              <div className="new-notebook">
                <input 
                  value={newNoteName} 
                  onChange={e => setNewNoteName(e.target.value)}
                  placeholder="Note name" 
                  onKeyDown={e => {
                    if (e.key === 'Enter') createNote();
                    if (e.key === 'Escape') { setShowNewNote(false); setNewNoteName(''); }
                  }}
                  autoFocus
                />
                <button onClick={createNote}>Create</button>
              </div>
            )}
            <div className="sort-controls">
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value as 'name' | 'updated' | 'created')}
                title="Sort by"
              >
                <option value="name">Name</option>
                <option value="updated">Modified</option>
                <option value="created">Created</option>
              </select>
              <button 
                onClick={toggleSortOrder} 
                className="sort-order-btn"
                title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            <ul>
              {sortedNotes.map(note => (
                renamingNote?.id === note.id ? (
                  <li key={note.id} className="renaming">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === 'Enter' && renameValue.trim()) {
                          const notebookPath = selectedNotebook?.path || notesDir;
                          if (!notebookPath) return;
                          try {
                            await invoke('rename_note', { 
                              notebookPath, 
                              oldId: note.id, 
                              newId: renameValue.trim() 
                            });
                            // Refresh notes list
                            const notesList = await invoke<Note[]>('list_notes', { notebookPath });
                            setNotes(notesList);
                            // Update selected note if it was renamed
                            if (selectedNote?.id === note.id) {
                              const renamedNote = notesList.find(n => n.id === renameValue.trim());
                              if (renamedNote) {
                                setSelectedNote(renamedNote);
                                // Update tab
                                setOpenTabs(prev => prev.map(t => 
                                  t.note.id === note.id ? { ...t, note: renamedNote } : t
                                ));
                                setActiveTabId(renamedNote.id);
                              }
                            }
                          } catch (err) {
                            console.error('Failed to rename:', err);
                            alert(`Failed to rename: ${err}`);
                          }
                          setRenamingNote(null);
                          setRenameValue('');
                        } else if (e.key === 'Escape') {
                          setRenamingNote(null);
                          setRenameValue('');
                        }
                      }}
                      onBlur={() => {
                        setRenamingNote(null);
                        setRenameValue('');
                      }}
                    />
                  </li>
                ) : (
                  <li 
                    key={note.id} 
                    className={`${selectedNote?.id === note.id ? 'selected' : ''} ${draggedNote?.id === note.id ? 'dragging' : ''}`}
                    onClick={() => openNoteInTab(note)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, note, inFavorites: false });
                    }}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', note.id);
                      setDraggedNote(note);
                    }}
                    onDragEnd={() => {
                      setDraggedNote(null);
                      setDropTarget(null);
                    }}
                  >
                    {favorites.includes(`${note.folder}/${note.id}`) && '⭐ '}
                    {getFileIcon(note.id)} {note.id}
                  </li>
                )
              ))}
            </ul>
          </div>
          <div className="resize-handle" onMouseDown={() => setIsResizingNotes(true)} />
        </aside>
      )}
      
      <main className="editor-area" onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        {/* Tabs bar */}
        {openTabs.length > 0 && (
          <div className="tabs-bar">
            {openTabs.map(tab => (
              <div
                key={tab.note.id}
                className={`tab ${activeTabId === tab.note.id ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''}`}
                onClick={() => switchTab(tab.note.id)}
              >
                <span className="tab-title">{tab.note.title || 'Untitled'}</span>
                {tab.isDirty && <span className="dirty-indicator">●</span>}
                <button className="tab-close" onClick={(e) => closeTab(tab.note.id, e)}>×</button>
              </div>
            ))}
          </div>
        )}
        
        {selectedNote ? (
          <>
            <div className="editor-toolbar">
              {isEditableFile(selectedNote.id) && (
                <button onClick={saveNote} disabled={isSaving}>
                  {isSaving ? 'Saving...' : '💾 Save'}
                </button>
              )}
              {saveIndicator === 'saved' && <span className="save-indicator">✓ Saved</span>}
              <button onClick={deleteNote}>🗑️ Delete</button>
              <button onClick={toggleFavorite}>{isFavorite ? '⭐' : '☆'} Favorite</button>
              {syncConfig?.enabled && (
                <button onClick={performSync} disabled={isSyncing}>{isSyncing ? '🔄 Syncing...' : '☁️ Sync'}</button>
              )}
              <div className="toolbar-spacer" />
              {syncStatus && <span className="sync-status">{syncStatus}</span>}
            </div>
            
            {/* Tags */}
            <div className="note-tags">
              {noteTags.map(tag => (
                <span key={tag} className="tag">
                  #{tag} <button onClick={() => removeTag(tag)}>×</button>
                </span>
              ))}
              {showTagInput ? (
                <input autoFocus value={newTag} onChange={e => setNewTag(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') setShowTagInput(false); }}
                  onBlur={() => { if (!newTag) setShowTagInput(false); }}
                  placeholder="Add tag..." className="tag-input" />
              ) : (
                <button className="add-tag-btn" onClick={() => setShowTagInput(true)}>+ Tag</button>
              )}
            </div>
            
            <div className="editor-wrapper" ref={editorWrapperRef} style={{ '--editor-split-ratio': `${editorSplitRatio}%` } as React.CSSProperties}>
              {isPdfFile(selectedNote.id, selectedNote.content) ? (
                <div className="pdf-preview-container">
                  <iframe 
                    src={`asset://localhost/${encodeURI(selectedNote.folder)}/${encodeURI(selectedNote.id)}`}
                    title="PDF Preview"
                  />
                </div>
              ) : isOfficeFile(selectedNote.id) ? (
                <div className="office-preview-container">
                  {officeLoading && (
                    <div className="office-loading">
                      <div className="loading-spinner" />
                      <span>Loading document...</span>
                    </div>
                  )}
                  {isExcelFile(selectedNote.id) && excelSheets.length > 1 && !officeLoading && (
                    <div className="excel-sheet-tabs">
                      {excelSheets.map(sheet => (
                        <button 
                          key={sheet} 
                          className={`sheet-tab ${activeSheet === sheet ? 'active' : ''}`}
                          onClick={() => setActiveSheet(sheet)}
                        >
                          {sheet}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={officeContainerRef} style={{ display: officeLoading ? 'none' : 'block' }} />
                </div>
              ) : (
                <>
                  <MDEditor 
                    value={content} 
                    onChange={handleContentChange}
                    height="100%" 
                    visibleDragbar={false}
                    preview={isEditableFile(selectedNote.id) ? "live" : "preview"}
                    hideToolbar={!isEditableFile(selectedNote.id)} 
                    previewOptions={{}}
                    commands={[
                      commands.bold,
                      commands.italic,
                      commands.strikethrough,
                    commands.hr,
                    commands.divider,
                    commands.link,
                    imageCommand,
                    commands.divider,
                    commands.unorderedListCommand,
                    commands.orderedListCommand,
                    commands.checkedListCommand,
                    commands.divider,
                    commands.code,
                    commands.codeBlock,
                    commands.quote,
                  ]}
                />
                  <div 
                    className="editor-split-handle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsResizingEditor(true);
                    }}
                  />
                </>
              )}
            </div>
            
            {/* Status bar */}
            <div className="status-bar">
              <span className="status-item file-path" title={`${selectedNote.folder}/${selectedNote.id}`}>
                {abbreviatePath(`${selectedNote.folder}/${selectedNote.id}`)}
              </span>
              <span className="status-spacer" />
              <span className="status-item">Words: {getWordCount(content)}</span>
              <span className="status-item">Characters: {getCharCount(content)}</span>
              <span className="status-item">Size: {formatFileSize(new Blob([content]).size)}</span>
              <span className="status-spacer" />
              <span className="status-item hint">:date :today :time</span>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Select or create a note</h2>
            <p>Select a folder on the left, then click the + button in the Notes section to create a new note.</p>
            <p className="hint">💡 Notes are saved as files in: {notesDir}</p>
          </div>
        )}
      </main>
      
      {showSearch && <SearchModal />}
      {showCommandPalette && <CommandPalette />}
      {settingsModalContent}
      {showHelp && <HelpModal />}
      {customizingNotebook && <NotebookCustomizeModal />}
      {contextMenu && <NotebookContextMenu />}
    </div>
  );
}

export default App;
