import express from "express";
import { getNepalLocationLookups } from "../controllers/locationLookupController.js";

const locationLookupRouter = express.Router();

locationLookupRouter.get("/nepal", getNepalLocationLookups);

export default locationLookupRouter;
