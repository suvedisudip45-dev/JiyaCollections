import { prisma } from '../config/db.js';

const DEFAULT_COLORS = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Brown', 'Grey', 'Navy'];

const addColor = async (req, res) => {
  try {
    const { name, nepaliName } = req.body;
    if (!name || !name.trim()) return res.json({ success: false, message: 'Color name is required' });
    const trimmedName = name.trim();
    const nepaliValue = (nepaliName || '').trim();
    const exists = await prisma.color.findFirst({ where: { name: trimmedName } });
    if (exists) return res.json({ success: false, message: 'Color already exists' });
    const color = await prisma.color.create({
      data: {
        name: trimmedName,
        nepaliName: nepaliValue,
      },
    });
    res.json({ success: true, message: 'Color Added', color });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const listColors = async (req, res) => {
  try {
    let colors = await prisma.color.findMany({});
    if (colors.length === 0) {
      for (const def of DEFAULT_COLORS) {
        await prisma.color.create({ data: { name: def } }).catch(() => {});
      }
      colors = await prisma.color.findMany({});
    }
    res.json({ success: true, colors });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const removeColor = async (req, res) => {
  try {
    const { id } = req.body;
    await prisma.color.delete({ where: { id } });
    res.json({ success: true, message: 'Color Removed' });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addColor, listColors, removeColor };
