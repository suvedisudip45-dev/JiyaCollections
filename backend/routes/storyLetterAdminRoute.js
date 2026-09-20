import express from "express";
import { authAdmin } from "../middleware/auth.js";
import {
  listStories,
  getStoryById,
  createStory,
  updateStory,
  listStoryLetters,
  createStoryLetter,
  updateStoryLetter,
  listTemplates,
  createTemplate,
  updateTemplate,
  toggleStoryArchive,
  toggleStoryLetterArchive,
  toggleTemplateArchive,
  reorderStoryLetters,
} from "../services/storyLetterAdminService.js";

const storyLetterAdminRouter = express.Router();

storyLetterAdminRouter.get("/stories", authAdmin, async (req, res) => {
  try {
    const stories = await listStories();
    return res.json({ success: true, data: stories });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to load stories." });
  }
});

storyLetterAdminRouter.post("/stories", authAdmin, async (req, res) => {
  try {
    const story = await createStory(req.body || {});
    return res.status(201).json({ success: true, data: story });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to create story." });
  }
});

storyLetterAdminRouter.patch("/stories/:id", authAdmin, async (req, res) => {
  try {
    const story = await updateStory(req.params.id, req.body || {});
    return res.json({ success: true, data: story });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to update story." });
  }
});

storyLetterAdminRouter.patch("/stories/:id/toggle-archive", authAdmin, async (req, res) => {
  try {
    const story = await toggleStoryArchive(req.params.id);
    return res.json({ success: true, data: story });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to toggle story archive state." });
  }
});

storyLetterAdminRouter.get("/stories/:id", authAdmin, async (req, res) => {
  try {
    const story = await getStoryById(req.params.id);
    return res.json({ success: true, data: story });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to load story." });
  }
});

storyLetterAdminRouter.get("/stories/:id/letters", authAdmin, async (req, res) => {
  try {
    const letters = await listStoryLetters(req.params.id);
    return res.json({ success: true, data: letters });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to load letters." });
  }
});

storyLetterAdminRouter.post("/stories/:id/letters", authAdmin, async (req, res) => {
  try {
    const letter = await createStoryLetter(req.params.id, req.body || {});
    return res.status(201).json({ success: true, data: letter });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to create letter." });
  }
});

storyLetterAdminRouter.patch("/stories/:id/letters/reorder", authAdmin, async (req, res) => {
  try {
    const letters = await reorderStoryLetters(req.params.id, req.body?.order || []);
    return res.json({ success: true, data: letters });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to reorder letters." });
  }
});

storyLetterAdminRouter.patch("/story-letters/:id", authAdmin, async (req, res) => {
  try {
    const letter = await updateStoryLetter(req.params.id, req.body || {});
    return res.json({ success: true, data: letter });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to update letter." });
  }
});

storyLetterAdminRouter.patch("/story-letters/:id/toggle-archive", authAdmin, async (req, res) => {
  try {
    const letter = await toggleStoryLetterArchive(req.params.id);
    return res.json({ success: true, data: letter });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to toggle letter archive state." });
  }
});

storyLetterAdminRouter.get("/templates", authAdmin, async (req, res) => {
  try {
    const templates = await listTemplates();
    return res.json({ success: true, data: templates });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to load templates." });
  }
});

storyLetterAdminRouter.post("/templates", authAdmin, async (req, res) => {
  try {
    const template = await createTemplate(req.body || {});
    return res.status(201).json({ success: true, data: template });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to create template." });
  }
});

storyLetterAdminRouter.patch("/templates/:id", authAdmin, async (req, res) => {
  try {
    const template = await updateTemplate(req.params.id, req.body || {});
    return res.json({ success: true, data: template });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to update template." });
  }
});

storyLetterAdminRouter.patch("/templates/:id/toggle-archive", authAdmin, async (req, res) => {
  try {
    const template = await toggleTemplateArchive(req.params.id);
    return res.json({ success: true, data: template });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to toggle template archive state." });
  }
});

export default storyLetterAdminRouter;
