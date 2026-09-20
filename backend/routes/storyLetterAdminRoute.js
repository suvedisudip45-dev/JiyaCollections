import express from "express";
import { authAdmin } from "../middleware/auth.js";
import {
  listStories,
  getStoryById,
  createStory,
  listStoryLetters,
  createStoryLetter,
  listTemplates,
  createTemplate,
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

export default storyLetterAdminRouter;
