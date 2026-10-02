import { Router } from 'express';
import { createProduct, listProducts, updateProduct } from '../controllers/productController.js';
import { authorize } from '../auth.js';
const router = Router();
router.get('/products', authorize('admin', 'kasir', 'teknisi'), listProducts);
router.post('/products', authorize('admin', 'kasir'), createProduct);
router.put('/products/:id', authorize('admin', 'kasir'), updateProduct);
export default router;