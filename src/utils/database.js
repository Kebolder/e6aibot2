const Database = require('better-sqlite3');
const path = require('path');

class KnowledgeBaseDB {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) {
            return;
        }

        try {
            const dbPath = path.join(__dirname, '..', '..', 'database.db');
            this.db = new Database(dbPath);
            this.createTables();
            this.initialized = true;
            console.log('Knowledge base database initialized');
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS knowledge_base (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                simple_name TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                image_url TEXT,
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.exec(createTableSQL);

        // Add image_url column if it doesn't exist (for existing databases)
        try {
            this.db.exec('ALTER TABLE knowledge_base ADD COLUMN image_url TEXT');
        } catch (error) {
            // Column already exists, ignore error
            if (!error.message.includes('duplicate column name')) {
                console.error('Error adding image_url column:', error);
            }
        }
    }

    addEntry(simpleName, title, body, imageUrl, createdBy) {
        this.initialize();
        try {
            const stmt = this.db.prepare(`
                INSERT INTO knowledge_base (simple_name, title, body, image_url, created_by)
                VALUES (?, ?, ?, ?, ?)
            `);

            const result = stmt.run(simpleName, title, body, imageUrl || null, createdBy);
            return { success: true, id: result.lastInsertRowid };
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'A knowledge base entry with that name already exists.' };
            }
            return { success: false, error: error.message };
        }
    }

    removeEntry(simpleName) {
        this.initialize();
        try {
            const stmt = this.db.prepare('DELETE FROM knowledge_base WHERE simple_name = ?');
            const result = stmt.run(simpleName);

            if (result.changes === 0) {
                return { success: false, error: 'Knowledge base entry not found.' };
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getEntry(simpleName) {
        this.initialize();
        try {
            const stmt = this.db.prepare('SELECT * FROM knowledge_base WHERE simple_name = ?');
            const entry = stmt.get(simpleName);

            if (!entry) {
                return { success: false, error: 'Knowledge base entry not found.' };
            }

            return { success: true, entry };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    listEntries() {
        this.initialize();
        try {
            const stmt = this.db.prepare(`
                SELECT simple_name, title, created_by, created_at
                FROM knowledge_base
                ORDER BY created_at DESC
            `);
            const entries = stmt.all();

            return { success: true, entries };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    updateEntry(oldSimpleName, newSimpleName, title, body, imageUrl, createdBy) {
        this.initialize();
        try {
            const stmt = this.db.prepare(`
                UPDATE knowledge_base
                SET simple_name = ?, title = ?, body = ?, image_url = ?, created_by = ?, created_at = CURRENT_TIMESTAMP
                WHERE simple_name = ?
            `);

            const result = stmt.run(newSimpleName, title, body, imageUrl || null, createdBy, oldSimpleName);

            if (result.changes === 0) {
                return { success: false, error: 'Knowledge base entry not found.' };
            }

            return { success: true };
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'A knowledge base entry with that name already exists.' };
            }
            return { success: false, error: error.message };
        }
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

const knowledgeBaseDB = new KnowledgeBaseDB();

module.exports = knowledgeBaseDB;