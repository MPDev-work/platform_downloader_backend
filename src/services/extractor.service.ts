import { create as createYtDlp } from 'yt-dlp-exec';
import path from 'path';
import fs from 'fs';
import { Job, jobService } from './job.service';

export const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Dynamically locate the yt-dlp executable
const resolveYtDlpBinary = (): string => {
  if (
    process.env.YOUTUBE_DL_PATH &&
    fs.existsSync(process.env.YOUTUBE_DL_PATH)
  ) {
    return process.env.YOUTUBE_DL_PATH;
  }
  if (fs.existsSync('/usr/local/bin/yt-dlp')) {
    return '/usr/local/bin/yt-dlp';
  }
  if (fs.existsSync('/usr/bin/yt-dlp')) {
    return '/usr/bin/yt-dlp';
  }
  const localBin = path.join(
    process.cwd(),
    'node_modules',
    'yt-dlp-exec',
    'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return 'yt-dlp';
};

const ytClient = createYtDlp(resolveYtDlpBinary());

const COOKIES_PATH = path.join(process.cwd(), 'cookies.txt');

// Initialize cookies file from environment variable if provided
if (process.env.YOUTUBE_COOKIES) {
  try {
    const formattedCookies = process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n');
    fs.writeFileSync(COOKIES_PATH, formattedCookies, 'utf8');
    console.log(
      'YouTube cookies loaded successfully from environment variable.',
    );
  } catch (e) {
    console.error('Failed to write cookies.txt from environment variable:', e);
  }
}

// Base flags to avoid bot detection and unlock full 4K/HD streaming formats
const BASE_EXTRACTOR_ARGS =
  'tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com;youtube:player_client=visionos,web,mweb';

const getBaseFlags = (): any => {
  const flags: any = {
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    jsRuntimes: 'node',
    extractorArgs: BASE_EXTRACTOR_ARGS,
  };

  if (fs.existsSync(COOKIES_PATH)) {
    flags.cookies = COOKIES_PATH;
  }

  return flags;
};

export const extractorService = {
  async getMediaInfo(url: string) {
    let parsed: any = null;

    try {
      const flags: any = {
        ...getBaseFlags(),
        dumpJson: true,
      };
      const info = await ytClient(url, flags);
      parsed = typeof info === 'string' ? JSON.parse(info) : info;
    } catch (error: any) {
      const errMsg = error?.stderr || error?.message || '';
      // If YouTube blocked the cloud IP with bot check, fallback to the Android client
      if (errMsg.includes('Sign in to confirm') || errMsg.includes('bot')) {
        console.log(
          'Bot challenge detected for YouTube, retrying with Android client fallback...',
        );
        const fallbackFlags: any = {
          ...getBaseFlags(),
          dumpJson: true,
          extractorArgs:
            'youtube:player_client=android;tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com',
        };
        const info = await ytClient(url, fallbackFlags);
        parsed = typeof info === 'string' ? JSON.parse(info) : info;
      } else {
        console.error('Error fetching media info:', error);
        throw new Error(
          errMsg ||
            'Unable to retrieve media information. Please check the URL and try again.',
        );
      }
    }

    return {
      platform: parsed.extractor,
      title: parsed.title,
      thumbnail: parsed.thumbnail,
      duration: parsed.duration,
      author: parsed.uploader || parsed.creator || parsed.channel,
      formats: parsed.formats?.map((f: any) => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution,
        filesize: f.filesize,
        vcodec: f.vcodec,
        acodec: f.acodec,
        quality: f.format_note || f.height ? `${f.height}p` : 'audio',
      })),
      raw: parsed,
    };
  },

  async processJob(jobId: string) {
    const job = jobService.getJob(jobId);
    if (!job) return;

    jobService.updateJob(jobId, { status: 'processing', progress: 10 });

    const outputTemplate = path.join(TEMP_DIR, `${jobId}.%(ext)s`);

    try {
      let format =
        'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best';

      if (job.type === 'audio') {
        format = 'bestaudio/best';
      } else {
        if (job.quality !== 'best') {
          // Prioritize H.264 / AVC up to requested height for universal playback
          const targetHeight = job.quality.replace('p', '');
          format = `bestvideo[vcodec^=avc1][height<=${targetHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
        }
      }

      const flags: any = {
        ...getBaseFlags(),
        output: outputTemplate,
        format: format,
      };

      if (job.type === 'audio') {
        flags.extractAudio = true;
        flags.audioFormat = job.format; // e.g., mp3
        flags.audioQuality =
          job.quality === 'best' ? '0' : job.quality.replace(' kbps', '');
      } else if (job.format === 'mp4') {
        flags.mergeOutputFormat = 'mp4';
      }

      const subprocess = ytClient.exec(job.url, flags);

      // Simulate progress for now, yt-dlp-exec progress parsing is complex without callbacks
      // We will just wait for completion

      const interval = setInterval(() => {
        const currentJob = jobService.getJob(jobId);
        if (
          currentJob &&
          currentJob.status === 'processing' &&
          currentJob.progress < 90
        ) {
          jobService.updateJob(jobId, { progress: currentJob.progress + 5 });
        }
      }, 2000);

      try {
        await subprocess;
      } catch (procErr: any) {
        const errMsg = procErr?.stderr || procErr?.message || '';
        if (errMsg.includes('Sign in to confirm') || errMsg.includes('bot')) {
          console.log(
            `Job ${jobId} hit bot challenge, retrying download with Android client fallback...`,
          );
          const fallbackFlags: any = {
            ...flags,
            extractorArgs:
              'youtube:player_client=android;tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com',
            format:
              'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best',
            mergeOutputFormat: 'mp4',
          };
          await ytClient.exec(job.url, fallbackFlags);
        } else {
          throw procErr;
        }
      }
      clearInterval(interval);

      // Find the created file
      const files = fs.readdirSync(TEMP_DIR);
      const outputFile = files.find((f) => f.startsWith(jobId));

      if (outputFile) {
        jobService.updateJob(jobId, {
          status: 'completed',
          progress: 100,
          downloadUrl: `/api/files/${outputFile}`,
        });
      } else {
        throw new Error('Output file not found after processing');
      }
    } catch (error: any) {
      console.error(`Job ${jobId} failed:`, error);
      jobService.updateJob(jobId, {
        status: 'failed',
        error: error.message || 'Processing failed',
      });
    }
  },

  async streamMedia({
    url,
    type,
    quality,
    format,
    res,
  }: {
    url: string;
    type: string;
    quality: string;
    format: string;
    res: any;
  }) {
    let ytdlpFormat =
      'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best';

    if (type === 'audio') {
      ytdlpFormat = 'bestaudio/best';
    } else {
      if (quality !== 'best') {
        const targetHeight = quality.replace('p', '');
        ytdlpFormat = `bestvideo[vcodec^=avc1][height<=${targetHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}]+bestaudio/best`;
      }
    }

    const flags: any = {
      ...getBaseFlags(),
      output: '-', // Stream to stdout
      format: ytdlpFormat,
      quiet: true, // Reduce logs polluting stdout
    };

    if (type === 'audio') {
      flags.extractAudio = true;
      flags.audioFormat = format; // e.g., mp3
      flags.audioQuality =
        quality === 'best' ? '0' : quality.replace(' kbps', '');
    } else if (format === 'mp4') {
      flags.mergeOutputFormat = 'mp4';
    }

    const subprocess = ytClient.exec(url, flags);

    return new Promise((resolve, reject) => {
      if (subprocess.stdout) {
        subprocess.stdout.pipe(res);
      } else {
        reject(new Error('Failed to get stdout from yt-dlp'));
      }

      subprocess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });

      subprocess.on('error', (err: any) => {
        reject(err);
      });

      // Handle client disconnect
      res.on('close', () => {
        subprocess.kill('SIGKILL');
      });
    });
  },
};
