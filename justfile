# Azimuth development commands

# Default recipe - show available commands
default:
    @just --list

# Install dependencies
install:
    npm install

# Run development server
dev:
    npm run tauri dev

# Build the application
build:
    npm run tauri build

# Build frontend only
build-frontend:
    npm run build

# Check Rust code
check:
    cd src-tauri && cargo check

# Format Rust code
fmt:
    cd src-tauri && cargo fmt

# Lint Rust code
clippy:
    cd src-tauri && cargo clippy

# Clean build artifacts
clean:
    cd src-tauri && cargo clean
    rm -rf dist

# Update dependencies
update:
    npm update
    cd src-tauri && cargo update

# Seed sample content in ~/Azimuth
seed:
    #!/usr/bin/env bash
    set -euo pipefail
    
    NOTES_DIR="$HOME/Azimuth"
    mkdir -p "$NOTES_DIR"
    
    # Create sample notebooks
    mkdir -p "$NOTES_DIR/Personal"
    mkdir -p "$NOTES_DIR/Work"
    mkdir -p "$NOTES_DIR/Projects"
    mkdir -p "$NOTES_DIR/Projects/WebApp"
    mkdir -p "$NOTES_DIR/Reference"
    mkdir -p "$NOTES_DIR/Code Snippets"
    
    # === MARKDOWN SHOWCASE ===
    cat > "$NOTES_DIR/Reference/Markdown Guide.md" << 'EOF'
    # Markdown Guide

    This document showcases all available Markdown features.

    ## Headings

    # Heading 1
    ## Heading 2
    ### Heading 3
    #### Heading 4
    ##### Heading 5
    ###### Heading 6

    ## Text Formatting

    This is **bold text** and this is *italic text*.

    This is ***bold and italic*** together.

    This is ~~strikethrough~~ text.

    This is `inline code` within a sentence.

    ## Lists

    ### Unordered Lists

    - Item 1
    - Item 2
      - Nested item 2.1
      - Nested item 2.2
        - Deeply nested item
    - Item 3

    ### Ordered Lists

    1. First item
    2. Second item
       1. Nested item 2.1
       2. Nested item 2.2
    3. Third item

    ### Task Lists

    - [x] Completed task
    - [x] Another completed task
    - [ ] Incomplete task
    - [ ] Another incomplete task

    ## Links and Images

    [Link to Google](https://www.google.com)

    [Link with title](https://www.google.com "Google Homepage")

    ![Alt text for image](https://via.placeholder.com/150)

    ## Blockquotes

    > This is a blockquote.
    > It can span multiple lines.
    >
    > > Nested blockquotes are also possible.

    ## Code Blocks

    ### JavaScript

    ```javascript
    function greet(name) {
      console.log(`Hello, ${name}!`);
      return { greeting: `Hello, ${name}!` };
    }

    const result = greet('World');
    ```

    ### Python

    ```python
    def fibonacci(n):
        """Generate Fibonacci sequence up to n."""
        a, b = 0, 1
        while a < n:
            yield a
            a, b = b, a + b

    for num in fibonacci(100):
        print(num)
    ```

    ### Rust

    ```rust
    fn main() {
        let numbers: Vec<i32> = (1..=10).collect();
        let sum: i32 = numbers.iter().sum();
        println!("Sum: {}", sum);
    }
    ```

    ### TypeScript

    ```typescript
    interface User {
      id: number;
      name: string;
      email: string;
    }

    const getUser = async (id: number): Promise<User> => {
      const response = await fetch(`/api/users/${id}`);
      return response.json();
    };
    ```

    ### Shell

    ```bash
    #!/bin/bash
    for file in *.txt; do
      echo "Processing $file"
      wc -l "$file"
    done
    ```

    ## Tables

    | Feature | Supported | Notes |
    |---------|:---------:|-------|
    | Headers | ✅ | H1 through H6 |
    | Bold | ✅ | **text** |
    | Italic | ✅ | *text* |
    | Code | ✅ | Inline and blocks |
    | Tables | ✅ | With alignment |
    | Lists | ✅ | Ordered and unordered |

    ### Aligned Table

    | Left | Center | Right |
    |:-----|:------:|------:|
    | L1 | C1 | R1 |
    | L2 | C2 | R2 |
    | L3 | C3 | R3 |

    ## Horizontal Rules

    ---

    ***

    ___

    ## HTML Elements

    <details>
    <summary>Click to expand</summary>

    This content is hidden by default and can be expanded.

    - Hidden item 1
    - Hidden item 2

    </details>

    <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy

    H<sub>2</sub>O is water.

    E = mc<sup>2</sup>

    ## Footnotes

    Here's a sentence with a footnote[^1].

    [^1]: This is the footnote content.

    ## Definition Lists

    Term 1
    : Definition for term 1

    Term 2
    : Definition for term 2

    ## Emoji

    :smile: :rocket: :heart: :thumbsup:

    Or use Unicode directly: 😀 🚀 ❤️ 👍

    ## Math (if supported)

    Inline math: $E = mc^2$

    Block math:

    $$
    \frac{n!}{k!(n-k)!} = \binom{n}{k}
    $$

    EOF
    
    # === PERSONAL NOTES ===
    cat > "$NOTES_DIR/Personal/Daily Journal.md" << 'EOF'
    # Daily Journal

    ## 2024-01-15

    Today was productive. Worked on the new feature and made good progress.

    ### Tasks Completed
    - [x] Morning standup
    - [x] Code review for PR #123
    - [x] Implement user authentication
    - [ ] Write documentation

    ### Notes
    - Remember to follow up with the design team
    - Need to schedule 1:1 with manager

    ---

    ## 2024-01-14

    Started the week with planning. Set goals for the sprint.

    > "The only way to do great work is to love what you do." - Steve Jobs

    EOF
    
    cat > "$NOTES_DIR/Personal/Reading List.md" << 'EOF'
    # Reading List 📚

    ## Currently Reading

    - **The Pragmatic Programmer** by David Thomas & Andrew Hunt
      - Progress: 60%
      - Notes: Great insights on software craftsmanship

    ## To Read

    1. Clean Code by Robert C. Martin
    2. Designing Data-Intensive Applications by Martin Kleppmann
    3. The Phoenix Project by Gene Kim

    ## Completed

    - [x] Atomic Habits by James Clear ⭐⭐⭐⭐⭐
    - [x] Deep Work by Cal Newport ⭐⭐⭐⭐
    - [x] The Lean Startup by Eric Ries ⭐⭐⭐⭐

    EOF
    
    # === WORK NOTES ===
    cat > "$NOTES_DIR/Work/Meeting Notes.md" << 'EOF'
    # Meeting Notes

    ## Sprint Planning - 2024-01-15

    **Attendees:** Alice, Bob, Charlie, Diana

    ### Agenda
    1. Review last sprint
    2. Discuss upcoming features
    3. Assign story points

    ### Action Items

    | Owner | Task | Due Date |
    |-------|------|----------|
    | Alice | Update API docs | Jan 18 |
    | Bob | Fix login bug | Jan 17 |
    | Charlie | Design review | Jan 16 |

    ### Notes

    - New feature request from client
    - Need to prioritize security updates
    - Consider adding caching layer

    ```
    Priority order:
    1. Security fixes
    2. Performance improvements
    3. New features
    ```

    EOF
    
    cat > "$NOTES_DIR/Work/Project Ideas.md" << 'EOF'
    # Project Ideas 💡

    ## High Priority

    ### Real-time Collaboration
    Add real-time collaboration features using WebSockets.

    **Technical Requirements:**
    - WebSocket server
    - Conflict resolution (CRDT or OT)
    - Presence indicators

    ### Mobile App
    Create a companion mobile app for iOS and Android.

    ## Medium Priority

    - [ ] Dark/Light theme toggle
    - [ ] Export to PDF
    - [ ] Plugin system
    - [ ] Vim keybindings

    ## Backlog

    1. AI-powered suggestions
    2. Voice notes
    3. Calendar integration

    EOF
    
    # === CODE SNIPPETS ===
    cat > "$NOTES_DIR/Code Snippets/JavaScript Utilities.md" << 'EOF'
    # JavaScript Utilities

    ## Debounce Function

    ```javascript
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    // Usage
    const debouncedSearch = debounce((query) => {
      console.log('Searching for:', query);
    }, 300);
    ```

    ## Deep Clone

    ```javascript
    const deepClone = (obj) => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(deepClone);
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, deepClone(v)])
      );
    };
    ```

    ## Async Queue

    ```javascript
    class AsyncQueue {
      constructor(concurrency = 1) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
      }

      async add(task) {
        return new Promise((resolve, reject) => {
          this.queue.push({ task, resolve, reject });
          this.process();
        });
      }

      async process() {
        while (this.running < this.concurrency && this.queue.length) {
          const { task, resolve, reject } = this.queue.shift();
          this.running++;
          try {
            resolve(await task());
          } catch (e) {
            reject(e);
          } finally {
            this.running--;
            this.process();
          }
        }
      }
    }
    ```

    EOF
    
    cat > "$NOTES_DIR/Code Snippets/SQL Queries.md" << 'EOF'
    # SQL Queries

    ## Common Patterns

    ### Pagination

    ```sql
    SELECT *
    FROM users
    ORDER BY created_at DESC
    LIMIT 20 OFFSET 40;
    ```

    ### Full-text Search

    ```sql
    SELECT id, title, 
           ts_rank(search_vector, query) AS rank
    FROM articles, plainto_tsquery('english', 'search term') query
    WHERE search_vector @@ query
    ORDER BY rank DESC
    LIMIT 10;
    ```

    ### Window Functions

    ```sql
    SELECT 
      name,
      department,
      salary,
      AVG(salary) OVER (PARTITION BY department) as dept_avg,
      RANK() OVER (PARTITION BY department ORDER BY salary DESC) as rank
    FROM employees;
    ```

    ### Recursive CTE

    ```sql
    WITH RECURSIVE subordinates AS (
      SELECT id, name, manager_id, 1 as level
      FROM employees
      WHERE manager_id IS NULL
      
      UNION ALL
      
      SELECT e.id, e.name, e.manager_id, s.level + 1
      FROM employees e
      JOIN subordinates s ON e.manager_id = s.id
    )
    SELECT * FROM subordinates;
    ```

    EOF
    
    # === PROJECT FILES ===
    cat > "$NOTES_DIR/Projects/WebApp/README.md" << 'EOF'
    # WebApp Project

    A modern web application built with React and TypeScript.

    ## Getting Started

    ```bash
    # Install dependencies
    npm install

    # Start development server
    npm run dev

    # Build for production
    npm run build
    ```

    ## Project Structure

    ```
    src/
    ├── components/
    │   ├── Button.tsx
    │   ├── Input.tsx
    │   └── Modal.tsx
    ├── hooks/
    │   ├── useAuth.ts
    │   └── useApi.ts
    ├── pages/
    │   ├── Home.tsx
    │   └── Dashboard.tsx
    └── utils/
        └── helpers.ts
    ```

    ## API Endpoints

    | Method | Endpoint | Description |
    |--------|----------|-------------|
    | GET | /api/users | List all users |
    | POST | /api/users | Create user |
    | GET | /api/users/:id | Get user by ID |
    | PUT | /api/users/:id | Update user |
    | DELETE | /api/users/:id | Delete user |

    EOF
    
    cat > "$NOTES_DIR/Projects/WebApp/Architecture.md" << 'EOF'
    # Architecture

    ## Overview

    ```
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   Client    │────▶│   Server    │────▶│  Database   │
    │   (React)   │◀────│   (Node)    │◀────│  (Postgres) │
    └─────────────┘     └─────────────┘     └─────────────┘
    ```

    ## Components

    ### Frontend
    - React 18 with TypeScript
    - TailwindCSS for styling
    - React Query for data fetching

    ### Backend
    - Node.js with Express
    - JWT authentication
    - RESTful API design

    ### Database
    - PostgreSQL 15
    - Prisma ORM
    - Redis for caching

    ## Data Flow

    1. User interacts with UI
    2. React component dispatches action
    3. API call made to backend
    4. Server validates request
    5. Database query executed
    6. Response sent back to client
    7. UI updates with new data

    EOF
    
    # === SAMPLE FILES IN OTHER FORMATS ===
    
    # JSON config
    cat > "$NOTES_DIR/Reference/config.json" << 'EOF'
    {
      "name": "azimuth",
      "version": "1.0.0",
      "settings": {
        "theme": "dark",
        "fontSize": 14,
        "autoSave": true,
        "syncEnabled": false
      },
      "shortcuts": {
        "save": "Cmd+S",
        "search": "Cmd+K",
        "newNote": "Cmd+N"
      }
    }
    EOF
    
    # YAML config
    cat > "$NOTES_DIR/Reference/docker-compose.yaml" << 'EOF'
    version: '3.8'

    services:
      app:
        build: .
        ports:
          - "3000:3000"
        environment:
          - NODE_ENV=production
          - DATABASE_URL=postgres://user:pass@db:5432/app
        depends_on:
          - db
          - redis

      db:
        image: postgres:15
        volumes:
          - postgres_data:/var/lib/postgresql/data
        environment:
          - POSTGRES_USER=user
          - POSTGRES_PASSWORD=pass
          - POSTGRES_DB=app

      redis:
        image: redis:7-alpine
        volumes:
          - redis_data:/data

    volumes:
      postgres_data:
      redis_data:
    EOF
    
    # Python script
    cat > "$NOTES_DIR/Code Snippets/data_processor.py" << 'EOF'
    #!/usr/bin/env python3
    """Data processing utilities."""

    import json
    from dataclasses import dataclass
    from typing import List, Optional
    from pathlib import Path


    @dataclass
    class Record:
        id: int
        name: str
        value: float
        tags: List[str]


    def load_data(filepath: Path) -> List[Record]:
        """Load records from a JSON file."""
        with open(filepath) as f:
            data = json.load(f)
        return [Record(**item) for item in data]


    def filter_by_tag(records: List[Record], tag: str) -> List[Record]:
        """Filter records that contain a specific tag."""
        return [r for r in records if tag in r.tags]


    def calculate_average(records: List[Record]) -> Optional[float]:
        """Calculate average value across all records."""
        if not records:
            return None
        return sum(r.value for r in records) / len(records)


    if __name__ == "__main__":
        # Example usage
        sample_data = [
            Record(1, "Alpha", 10.5, ["important", "review"]),
            Record(2, "Beta", 20.3, ["draft"]),
            Record(3, "Gamma", 15.7, ["important"]),
        ]
        
        important = filter_by_tag(sample_data, "important")
        avg = calculate_average(important)
        print(f"Average of important records: {avg:.2f}")
    EOF
    
    # Rust code
    cat > "$NOTES_DIR/Code Snippets/utils.rs" << 'EOF'
    //! Utility functions for common operations.

    use std::collections::HashMap;

    /// Counts the frequency of each word in the given text.
    pub fn word_frequency(text: &str) -> HashMap<String, usize> {
        let mut freq = HashMap::new();
        for word in text.split_whitespace() {
            let word = word.to_lowercase();
            *freq.entry(word).or_insert(0) += 1;
        }
        freq
    }

    /// Checks if a string is a palindrome.
    pub fn is_palindrome(s: &str) -> bool {
        let chars: Vec<char> = s.chars().filter(|c| c.is_alphanumeric()).collect();
        let len = chars.len();
        for i in 0..len / 2 {
            if chars[i].to_lowercase().next() != chars[len - 1 - i].to_lowercase().next() {
                return false;
            }
        }
        true
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_word_frequency() {
            let freq = word_frequency("hello world hello");
            assert_eq!(freq.get("hello"), Some(&2));
            assert_eq!(freq.get("world"), Some(&1));
        }

        #[test]
        fn test_palindrome() {
            assert!(is_palindrome("A man a plan a canal Panama"));
            assert!(!is_palindrome("hello"));
        }
    }
    EOF
    
    # Plain text
    cat > "$NOTES_DIR/Personal/Quick Notes.txt" << 'EOF'
    Quick Notes
    ===========

    Things to remember:

    - Call dentist for appointment
    - Buy groceries: milk, eggs, bread
    - Return library books by Friday
    - Schedule car maintenance

    Ideas:
    - Learn a new programming language
    - Start a side project
    - Read more books

    Quotes I like:
    "Simplicity is the ultimate sophistication." - Leonardo da Vinci
    "Code is like humor. When you have to explain it, it's bad." - Cory House
    EOF
    
    # CSV data
    cat > "$NOTES_DIR/Reference/sample_data.csv" << 'EOF'
    id,name,email,department,salary
    1,Alice Johnson,alice@example.com,Engineering,95000
    2,Bob Smith,bob@example.com,Marketing,75000
    3,Charlie Brown,charlie@example.com,Engineering,105000
    4,Diana Ross,diana@example.com,Sales,85000
    5,Eve Wilson,eve@example.com,Engineering,98000
    EOF
    
    # Shell script
    cat > "$NOTES_DIR/Code Snippets/backup.sh" << 'EOF'
    #!/bin/bash
    # Backup script for important files

    set -euo pipefail

    BACKUP_DIR="${HOME}/backups"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_NAME="backup_${TIMESTAMP}.tar.gz"

    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_DIR"

    # Files and directories to backup
    SOURCES=(
        "$HOME/Documents"
        "$HOME/Projects"
        "$HOME/.config"
    )

    echo "Starting backup..."

    # Create compressed archive
    tar -czf "${BACKUP_DIR}/${BACKUP_NAME}" "${SOURCES[@]}" 2>/dev/null || true

    echo "Backup completed: ${BACKUP_DIR}/${BACKUP_NAME}"

    # Remove backups older than 30 days
    find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +30 -delete

    echo "Cleanup completed."
    EOF
    
    echo "✅ Seed data created in $NOTES_DIR"
    echo ""
    echo "Created notebooks:"
    echo "  - Personal (Daily Journal, Reading List, Quick Notes)"
    echo "  - Work (Meeting Notes, Project Ideas)"
    echo "  - Projects/WebApp (README, Architecture)"
    echo "  - Reference (Markdown Guide, config files, sample data)"
    echo "  - Code Snippets (JavaScript, SQL, Python, Rust, Shell)"
