import { create as createYtDlp } from 'yt-dlp-exec';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Job, jobService } from './job.service';

const execFileAsync = promisify(execFile);

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

// Build a format string that prefers H.264/AVC at the requested height
// (works reliably on iPhone/QuickTime/AVPlayer), falling back to
// VP9/AV1 only when no AVC stream exists at that resolution.
const buildVideoFormat = (
  quality: string,
  { avcOnly = false }: { avcOnly?: boolean } = {},
): string => {
  if (quality === 'best') {
    return avcOnly
      ? 'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best'
      : 'bestvideo+bestaudio/best';
  }

  const targetHeight = parseInt(quality.replace('p', ''), 10);
  if (isNaN(targetHeight)) {
    return 'bestvideo+bestaudio/best';
  }

  return `bestvideo[vcodec^=avc1][height<=${targetHeight}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
};

// --- iPhone compatibility helpers ---------------------------------------

async function getVideoCodec(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    return stdout.trim();
  } catch (e) {
    console.error('ffprobe failed, skipping compat check:', e);
    return null;
  }
}

// If the downloaded video isn't H.264/HEVC (e.g. VP9/AV1 forced above
// 1080p), transcode it so it actually plays on iPhone. Returns the
// final file path (unchanged if no transcode was needed).
async function ensureIphoneCompatible(filePath: string): Promise<string> {
  const codec = await getVideoCodec(filePath);

  if (!codec) return filePath; // ffprobe unavailable/failed — don't block the job
  if (codec === 'h264' || codec === 'hevc') return filePath;

  console.log(`Transcoding ${path.basename(filePath)} (${codec} -> h264) for iPhone compatibility...`);

  const outPath = filePath.replace(/\.\w+$/, '.compat.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    ]);
    fs.unlinkSync(filePath);
    return outPath;
  } catch (e) {
    console.error('ffmpeg transcode failed, keeping original file:', e);
    return filePath;
  }
}

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
        height: f.height,
        width: f.width,
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
      let format = 'bestvideo+bestaudio/best';

      if (job.type === 'audio') {
        format = 'bestaudio/best';
      } else {
        // Always try H.264 first, at ANY resolution, for iPhone/QuickTime
        // compatibility. If YouTube truly has no AVC stream that high
        // (common above ~1080p), this falls back to VP9/AV1 and the
        // ensureIphoneCompatible() step below will transcode it afterward.
        format = buildVideoFormat(job.quality);
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
              job.type === 'audio'
                ? format
                : 'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best',
            mergeOutputFormat: 'mp4',
          };
          await ytClient.exec(job.url, fallbackFlags);
        } else {
          throw procErr;
        }
      }
      clearInterval(interval);

      // Find the created file
      let files = fs.readdirSync(TEMP_DIR);
      let outputFile = files.find((f) => f.startsWith(jobId));

      if (!outputFile) {
        throw new Error('Output file not found after processing');
      }

      // For video jobs, make sure the final codec actually plays on iPhone.
      if (job.type !== 'audio') {
        const fullPath = path.join(TEMP_DIR, outputFile);
        const compatPath = await ensureIphoneCompatible(fullPath);
        outputFile = path.basename(compatPath);
      }

      jobService.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        downloadUrl: `/api/files/${outputFile}`,
      });
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
      type === 'audio' ? 'bestaudio/best' : buildVideoFormat(quality);

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

    // NOTE: streaming directly to stdout means there's no file on disk to
    // run ensureIphoneCompatible() against, so a VP9/AV1 fallback here can
    // still produce a stream that won't play on iPhone. If that matters for
    // your use case, prefer processJob (file-based) for iPhone clients, or
    // pipe through `ffmpeg -i pipe:0 -c:v libx264 -c:a aac -f mp4 pipe:1`
    // before writing to `res`.
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
