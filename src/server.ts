import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.routes';
import { cleanupService } from './services/cleanup.service';
import { TEMP_DIR } from './services/extractor.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}));
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30'),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Routes
app.use('/api', apiRoutes);

import { jobService } from './services/job.service';

// File serving route for downloads
app.get('/api/files/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(TEMP_DIR, filename);
  
  // Basic path traversal protection
  if (!filePath.startsWith(TEMP_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  
  const jobId = filename.split('.')[0];
  const job = jobService.getJob(jobId);
  const ext = path.extname(filename);
  
  if (job && job.title) {
    // Sanitize title to avoid issues with filename
    const sanitizedTitle = job.title.replace(/[^\w\s-]/g, '').trim().substring(0, 100);
    return res.download(filePath, `${sanitizedTitle}${ext}`);
  }
  
  res.download(filePath);
});

// Start cleanup cron
cleanupService.start();

app.listen(PORT, () => {
  console.log(`MediaFetch Backend running on port ${PORT}`);
});
