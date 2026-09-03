import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'jobs.sqlite');
const db = new Database(DB_PATH);

// Initialize DB schema
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    platform TEXT,
    type TEXT NOT NULL,
    quality TEXT NOT NULL,
    format TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    downloadUrl TEXT,
    error TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME
  )
`);

export interface Job {
  id: string;
  url: string;
  title: string | null;
  platform: string;
  type: string;
  quality: string;
  format: string;
  status: 'queued' | 'processing' | 'merging' | 'converting' | 'completed' | 'failed' | 'expired';
  progress: number;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export const jobService = {
  createJob(job: Partial<Job>): Job {
    const id = job.id || Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiration
    
    const stmt = db.prepare(`
      INSERT INTO jobs (id, url, title, platform, type, quality, format, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, job.url, job.title || null, job.platform, job.type, job.quality, job.format, expiresAt);
    
    return this.getJob(id)!;
  },
  
  getJob(id: string): Job | undefined {
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(id) as Job | undefined;
  },
  
  updateJob(id: string, updates: Partial<Job>) {
    const current = this.getJob(id);
    if (!current) return;
    
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    
    if (keys.length === 0) return;
    
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const stmt = db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`);
    stmt.run(...values, id);
  },
  
  getExpiredJobs(): Job[] {
    const stmt = db.prepare('SELECT * FROM jobs WHERE expiresAt < datetime(\'now\') AND status != \'expired\'');
    return stmt.all() as Job[];
  },
  
  markExpired(id: string) {
    const stmt = db.prepare('UPDATE jobs SET status = \'expired\' WHERE id = ?');
    stmt.run(id);
  }
};
