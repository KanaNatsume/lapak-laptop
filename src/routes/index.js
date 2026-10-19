import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import productRoutes from './productRoutes.js';
import customerRoutes from './customerRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import authRoutes from './authRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import userRoutes from './userRoutes.js';
import cashRoutes from './cashRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import serviceAccountingRoutes from './serviceAccountingRoutes.js';
import freightRoutes from './freightRoutes.js';
import reportRoutes from './reportRoutes.js';
import reconciliationRoutes from './reconciliationRoutes.js';
import { authenticate } from '../auth.js';

const router = Router();

router.use('/api', healthRoutes);
router.use('/api', authRoutes);
router.use('/api', authenticate);
router.use('/api', productRoutes);
router.use('/api', customerRoutes);
router.use('/api', serviceRoutes);
router.use('/api', transactionRoutes);
router.use('/api', settingsRoutes);
router.use('/api', notificationRoutes);
router.use('/api', userRoutes);
router.use('/api', cashRoutes);
router.use('/api', inventoryRoutes);
router.use('/api', serviceAccountingRoutes);
router.use('/api', freightRoutes);
router.use('/api', reportRoutes);
router.use('/api', reconciliationRoutes);

export default router;