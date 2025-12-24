import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { watch } from '@tauri-apps/plugin-fs';
import MDEditor from '@uiw/react-md-editor';
import rehypeRaw from 'rehype-raw';
import { v4 as uuidv4 } from 'uuid';
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
  const [activeTabId, setActiveTabId] = useState<string | null>(null);  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
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
  
  // Drag and drop state for notebooks
  const [draggedNotebook, setDraggedNotebook] = useState<Notebook | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [isChangingDirectory, setIsChangingDirectory] = useState(true); // Start true for initial load
  
  // Notes sorting
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'created'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Notebook customization
  const [customizingNotebook, setCustomizingNotebook] = useState<Notebook | null>(null);
  
  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [notesWidth, setNotesWidth] = useState(200);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingNotes, setIsResizingNotes] = useState(false);

  const notesDirRef = useRef(notesDir);
  const notebooksRef = useRef(notebooks);

  useEffect(() => { notesDirRef.current = notesDir; }, [notesDir]);
  useEffect(() => { notebooksRef.current = notebooks; }, [notebooks]);

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
    
    const newTabs = openTabs.filter(t => t.note.id !== noteId);
    setOpenTabs(newTabs);
    
    if (activeTabId === noteId) {
      if (newTabs.length > 0) {
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab.note.id);
        setSelectedNote(lastTab.note);
        setContent(lastTab.content);
      } else {
        setActiveTabId(null);
        setSelectedNote(null);
        setContent('');
      }
    }
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
  };

  // Store pending init state for completion handler
  const pendingInitRef = useRef<{ dir: string } | null>(null);

  // Listen for load-complete events from Rust
  useEffect(() => {
    let mounted = true;
    
    const setup = async () => {
      try {
        await listen<LoadComplete>('load-complete', async (event) => {
          if (!mounted) return;
          
          setNotebooks(event.payload.notebooks);
          
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
              setFavorites(appSettings.favorites);
              
              const tags = await invoke<string[]>('get_all_tags', { basePath: dir });
              setAllTags(tags);
            } catch (e) {
              console.error('Failed to load settings:', e);
            }
          }
          
          setIsChangingDirectory(false);
        });
        
        initApp();
      } catch (e) {
        console.error('Failed to set up listeners:', e);
      }
    };
    
    setup();
    
    return () => {
      mounted = false;
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
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNote, selectedNotebook, content]);

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
    };
    
    const handleMouseUp = () => {
      if (isResizingSidebar || isResizingNotes) {
        setIsResizingSidebar(false);
        setIsResizingNotes(false);
        if (settings && notesDir) {
          const newSettings = { ...settings, sidebar_width: sidebarWidth, notes_width: notesWidth };
          invoke('save_settings', { basePath: notesDir, settings: newSettings });
        }
      }
    };
    
    if (isResizingSidebar || isResizingNotes) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingNotes, sidebarWidth, notesWidth, settings, notesDir]);

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

  useEffect(() => {
    if (selectedNotebook) loadNotes(selectedNotebook);
  }, [selectedNotebook, loadNotes]);

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

  const updateFontFamily = async (family: string) => {
    if (!settings || !notesDir) return;
    const newSettings = { ...settings, font_family: family };
    setSettings(newSettings);
    await invoke('save_settings', { basePath: notesDir, settings: newSettings });
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

  const NotebookItem = ({ notebook, depth = 0 }: { notebook: Notebook; depth?: number }) => {
    const hasChildren = isExpandable(notebook);
    const isExpanded = expandedFolders.has(notebook.id);
    const isSelected = selectedNotebook?.id === notebook.id;
    const isDragging = draggedNotebook?.id === notebook.id;
    const isDropTarget = dropTarget === notebook.id;
    const isLoading = loadingFolders.has(notebook.id);
    const style = getNotebookStyle(notebook.path);
    const childrenLoaded = hasRealChildren(notebook);

    return (
      <>
        <li
          className={`notebook-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          style={{ paddingLeft: `${8 + depth * 12}px`, color: style.color }}
          onClick={() => setSelectedNotebook(notebook)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCustomizingNotebook(notebook);
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
            if (draggedNotebook && draggedNotebook.id !== notebook.id) {
              setDropTarget(notebook.id);
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (draggedNotebook && draggedNotebook.id !== notebook.id) {
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
            setDraggedNotebook(null);
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
            {notebook.children.map((child, idx) => (
              <NotebookItem key={`${child.id}-${idx}`} notebook={child} depth={depth + 1} />
            ))}
          </ul>
        )}
      </>
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
    if (!selectedNotebook) return;
    const noteId = `${uuidv4()}.md`;
    const newNote: Note = {
      id: noteId,
      title: 'Untitled',
      content: '# New Note\n\nStart writing...',
      folder: selectedNotebook.path,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      await invoke('save_note', { notebookPath: selectedNotebook.path, noteId, content: newNote.content });
      setNotes([...notes, newNote]);
      openNoteInTab(newNote);
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

  const saveNote = async () => {
    if (!selectedNote || !selectedNotebook) return;
    setIsSaving(true);
    setSaveIndicator('saving');
    try {
      await invoke('save_note', { notebookPath: selectedNotebook.path, noteId: selectedNote.id, content });
      const title = content.split('\n')[0].replace(/^#\s*/, '') || 'Untitled';
      const updatedNote = { ...selectedNote, content, title, updated_at: new Date().toISOString() };
      setSelectedNote(updatedNote);
      setNotes(notes.map(n => n.id === selectedNote.id ? updatedNote : n));
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
    if (!selectedNote || !selectedNotebook) return;
    if (!confirm('Delete this note?')) return;
    try {
      await invoke('delete_note', { notebookPath: selectedNotebook.path, noteId: selectedNote.id });
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

  const SettingsModal = () => (
    <div className="modal-overlay" onClick={() => setShowSettings(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
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
          <label>Font Family</label>
          <select
            value={settings?.font_family || "'SF Mono', 'Fira Code', 'Consolas', monospace"}
            onChange={e => updateFontFamily(e.target.value)}
          >
            <option value="'SF Mono', 'Fira Code', 'Consolas', monospace">Monospace (Default)</option>
            <option value="'SF Mono', monospace">SF Mono</option>
            <option value="'Fira Code', monospace">Fira Code</option>
            <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
            <option value="'Cascadia Code', monospace">Cascadia Code</option>
            <option value="'Source Code Pro', monospace">Source Code Pro</option>
            <option value="system-ui, sans-serif">System UI</option>
            <option value="Georgia, serif">Georgia</option>
          </select>
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
  );

  const editorStyle = settings ? {
    '--editor-font-family': settings.font_family,
    '--editor-font-size': `${settings.font_size}px`,
  } as React.CSSProperties : {};

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
          <h1>Azimuth</h1>
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
        
        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="favorites-section">
            <div className="section-header"><span>⭐ Favorites</span></div>
            <ul>
              {favorites.map(fav => {
                const parts = fav.split('/');
                const noteId = parts.pop() || '';
                const notebookPath = parts.join('/');
                return (
                  <li key={fav} onClick={async () => {
                    const notebook = findNotebookByPath(notebooks, notebookPath);
                    if (notebook) {
                      setSelectedNotebook(notebook);
                      const notesList = await invoke<Note[]>('list_notes', { notebookPath });
                      setNotes(notesList);
                      const note = notesList.find(n => n.id === noteId);
                      if (note) { openNoteInTab(note); }
                    }
                  }}>
                    ⭐ {noteId.replace(/\.[^/.]+$/, '')}
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
            if (draggedNotebook) {
              setDropTarget('root');
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (draggedNotebook) {
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
            setDraggedNotebook(null);
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
            {notebooks.map((nb, idx) => <NotebookItem key={`${nb.id}-${idx}`} notebook={nb} />)}
          </ul>
        </div>
        <div className="resize-handle" onMouseDown={() => setIsResizingSidebar(true)} />
      </aside>
      
      {selectedNotebook && (
        <aside className="notes-sidebar" style={{ width: notesWidth }}>
          <div className="notes-list">
            <div className="section-header">
              <span>Notes</span>
              <button onClick={createNote}>+</button>
            </div>
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
                <li key={note.id} className={selectedNote?.id === note.id ? 'selected' : ''}
                  onClick={() => openNoteInTab(note)}>
                  {favorites.includes(`${note.folder}/${note.id}`) && '⭐ '}
                  {getFileIcon(note.id)} {note.title || 'Untitled'}
                </li>
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
            
            <div className="editor-wrapper" style={editorStyle}>
              <MDEditor value={content} onChange={handleContentChange}
                height="100%" preview={isEditableFile(selectedNote.id) ? "live" : "preview"}
                hideToolbar={!isEditableFile(selectedNote.id)} previewOptions={{ rehypePlugins: [rehypeRaw] }} />
            </div>
            
            {/* Status bar */}
            <div className="status-bar">
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
            <p>Choose a notebook and note from the sidebar, or create a new one.</p>
            <p className="hint">💡 Press Cmd+K to search all notes</p>
          </div>
        )}
      </main>
      
      {showSearch && <SearchModal />}
      {showSettings && <SettingsModal />}
      {customizingNotebook && <NotebookCustomizeModal />}
    </div>
  );
}

export default App;
