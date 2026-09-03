import { Router } from 'express';
import { mediaController } from '../controllers/media.controller';

const router = Router();

router.post('/media/info', mediaController.getInfo);
router.post('/download', mediaController.download);
router.get('/download/direct', mediaController.downloadDirect);
router.get('/download/:jobId', mediaController.getJobStatus);

export default router;
