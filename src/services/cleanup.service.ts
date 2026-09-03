import fs from 'fs';
import path from 'path';
import { jobService } from './job.service';
import { TEMP_DIR } from './extractor.service';

export const cleanupService = {
  start() {
    // Run every 10 minutes
    setInterval(
      () => {
        this.runCleanup();
      },
      10 * 60 * 1000,
    );

    // Run once on startup
    this.runCleanup();
  },

  runCleanup() {
    console.log('Running cleanup cron...');
    const expiredJobs = jobService.getExpiredJobs();

    for (const job of expiredJobs) {
      console.log(`Cleaning up expired job: ${job.id}`);
      try {
        if (!fs.existsSync(TEMP_DIR)) continue;

        const files = fs.readdirSync(TEMP_DIR);
        for (const file of files) {
          if (file.startsWith(job.id)) {
            const filePath = path.join(TEMP_DIR, file);
            fs.unlinkSync(filePath);
            console.log(`Deleted file: ${filePath}`);
          }
        }

        jobService.markExpired(job.id);
      } catch (error) {
        console.error(`Error cleaning up job ${job.id}:`, error);
      }
    }
  },
};
