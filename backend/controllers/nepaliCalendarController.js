import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  getNepaliCalendarDateFromAD,
  getNepaliCalendarYears,
  saveNepaliCalendarYear,
} from "../services/nepaliFiscalCalendar.js";

export const listNepaliCalendarYears = async (req, res) => {
  try {
    const years = await getNepaliCalendarYears();
    const currentDate = await getNepaliCalendarDateFromAD(new Date(), years);
    return res.json({ success: true, years, currentDate });
  } catch (error) {
    console.error("List Nepali Calendar Years Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveNepaliCalendarYearAdmin = async (req, res) => {
  try {
    const year = Number(req.params.year || req.body?.year);
    if (req.params.year && year !== Number(req.body?.year)) {
      return res.status(400).json({
        success: false,
        message: "The BS year in the URL must match the submitted calendar year.",
        code: "CALENDAR_YEAR_MISMATCH",
      });
    }

    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const savedYear = await saveNepaliCalendarYear(
      { ...req.body, year },
      prisma,
      (created, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "NEPALI_CALENDAR_YEAR_CREATED",
          entityType: "NepaliCalendarYear",
          entityId: String(created.year),
          afterState: {
            year: Number(created.year),
            adStartDate: created.adStartDate,
            monthDays: created.monthDays,
          },
        },
        { client: tx },
      ),
    );
    return res.status(200).json({ success: true, year: savedYear });
  } catch (error) {
    console.error("Save Nepali Calendar Year Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
};
