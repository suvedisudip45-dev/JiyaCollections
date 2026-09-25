import express from 'express';
import { addColor, listColors, removeColor } from '../controllers/colorController.js';
import { authenticate, authorize } from '../middleware/unifiedAuth.js';

const colorRouter = express.Router();

colorRouter.post('/add', authenticate, authorize('color:create'), addColor);
colorRouter.get('/list', listColors);
colorRouter.post('/remove', authenticate, authorize('color:delete'), removeColor);

export default colorRouter;
