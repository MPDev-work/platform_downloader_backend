import { Request, Response } from 'express';
import { z } from 'zod';
import { extractorService } from '../services/extractor.service';
import { jobService } from '../services/job.service';

const infoSchema = z.object({
  url: z.string().url(),
});

const downloadSchema = z.object({
  url: z.string().url(),
  type: z.enum(['video', 'audio']),
  quality: z.string(),
  format: z.string(),
});

export const mediaController = {
  async getInfo(req: Request, res: Response): Promise<void> {
    try {
      const { url } = infoSchema.parse(req.body);
      const info = await extractorService.getMediaInfo(url);
      res.json(info);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid URL provided' });
        return;
      }
      res
        .status(400)
        .json({
          error: error.message || 'Failed to retrieve media information',
        });
    }
  },

  async download(req: Request, res: Response): Promise<void> {
    try {
      const { url, type, quality, format } = downloadSchema.parse(req.body);

      // Determine platform
      const info = await extractorService.getMediaInfo(url);

      const job = jobService.createJob({
        url,
        title: info.title,
        platform: info.platform,
        type,
        quality,
        format,
      });

      // Start processing in background
      extractorService.processJob(job.id).catch(console.error);

      res.json({ jobId: job.id });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid parameters provided' });
        return;
      }
      res
        .status(400)
        .json({ error: error.message || 'Failed to start download' });
    }
  },

  async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const job = jobService.getJob(jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json({
        status: job.status,
        progress: job.progress,
        downloadUrl: job.downloadUrl,
        error: job.error,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async downloadDirect(req: Request, res: Response): Promise<void> {
    try {
      const { url, type, quality, format } = req.query;

      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Invalid URL provided' });
        return;
      }

      // Determine platform and title
      const info = await extractorService.getMediaInfo(url);

      // Clean title for filename (remove invalid characters)
      const cleanTitle = (info.title || 'download').replace(
        /[/\\?%*:|"<>]/g,
        '-',
      );
      const ext = type === 'audio' ? format || 'mp3' : 'mp4';
      const filename = `${cleanTitle}.${ext}`;

      // Set headers for file download
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      if (type === 'audio') {
        res.setHeader('Content-Type', 'audio/mpeg'); // approximation
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }

      // Stream directly
      await extractorService.streamMedia({
        url,
        type: (type as string) || 'video',
        quality: (quality as string) || 'best',
        format: (format as string) || 'mp4',
        res,
      });
    } catch (error: any) {
      console.error('Direct download error:', error);
      if (!res.headersSent) {
        res
          .status(400)
          .json({ error: error.message || 'Failed to start download' });
      } else {
        res.end();
      }
    }
  },
};
