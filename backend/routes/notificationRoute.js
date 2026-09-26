import express from "express";
import { createIncomingSmsHandler } from "../notifications/inboundSmsController.js";

const notificationRouter = express.Router();
notificationRouter.get("/sms/incoming", createIncomingSmsHandler());

export default notificationRouter;
