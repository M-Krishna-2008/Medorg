import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import multer from "multer";
import path from "path";
import fs from "fs";
import { invalidatePdfCache } from "../ai/pdfExtractor";

// RecordType type
type RecordType = "REPORT" | "PRESCRIPTION";

// Ensure upload directories exist (absolute paths)
const uploadsRoot = path.resolve(config.dataDir, "uploads");
const reportsDir = path.resolve(uploadsRoot, "reports");
const prescriptionsDir = path.resolve(uploadsRoot, "prescriptions");
const tempDir = path.resolve(uploadsRoot, "temp");

for (const dir of [uploadsRoot, reportsDir, prescriptionsDir, tempDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Multer storage with collision-safe names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pdf") {
      return cb(new Error("Only PDF files are allowed"), "");
    }
    const safeName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
    cb(null, safeName);
  },
});

// Filter: PDF only
const fileFilter = (req: any, file: any, cb: any) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = file.mimetype === "application/pdf";
  if (ext !== ".pdf" || !mimeOk) {
    return cb(new Error("Only PDF files are allowed"), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

const router = Router();

// Doctor uploads a PDF record
router.post("/upload", upload.single("record"), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Please select a PDF file." });
    }

    const { patientId, doctorId, recordType, title, description } = req.body;

    if (!patientId || !doctorId || !recordType) {
      // Clean up uploaded file
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Patient ID, Doctor ID, and record type are required" });
    }

    // Validate record type
    const validTypes: RecordType[] = ["REPORT", "PRESCRIPTION"];
    if (!validTypes.includes(recordType as RecordType)) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid record type" });
    }

    // Find patient and doctor
    const patient = await prisma.user.findUnique({ where: { id: patientId } });
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });

    if (!patient) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Patient not found" });
    }

    if (!doctor) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Doctor not found" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const storedFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;

    // Determine target directory
    const targetDir = recordType === "REPORT" ? reportsDir : prescriptionsDir;
    const filePath = path.join(targetDir, storedFileName);

    // Move from temp to target directory
    fs.renameSync(req.file.path, filePath);

    // Get file size
    const fileSize = fs.statSync(filePath).size;

    // Create the medical record
    const medicalRecord = await prisma.medicalRecord.create({
      data: {
        patientId,
        doctorId,
        recordType: recordType as RecordType,
        title: title || `${recordType} Record`,
        description: description || "",
        originalFileName: req.file.originalname,
        storedFileName,
        filePath,
        mimeType: req.file.mimetype,
        fileSize,
      },
    });

    // Invalidate cached text if any
    invalidatePdfCache(medicalRecord.id);
    await prisma.notification.create({
      data: {
        userType: "PATIENT",
        userId: patient.id,
        type: "RECORD_UPLOADED",
        title: "New Medical Record",
        message: `Dr. ${doctor.name} has uploaded a ${recordType.toLowerCase()} record: ${title || ""}`,
      },
    });

    res.json({ 
      success: true, 
      record: {
        id: medicalRecord.id,
        title: medicalRecord.title,
        recordType: medicalRecord.recordType,
        uploadedAt: medicalRecord.uploadedAt,
      } 
    });
  } catch (error: any) {
    // Clean up uploaded file if record creation fails
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Get record metadata
router.get("/:id", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
      include: {
        patient: {
          select: { id: true, name: true, medOrgId: true },
        },
        doctor: {
          select: { id: true, name: true, doctorId: true },
        },
      },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    // Never leak filePath or storedFileName
    res.json({ 
      record: {
        id: record.id,
        title: record.title,
        recordType: record.recordType,
        description: record.description,
        originalFileName: record.originalFileName,
        mimeType: record.mimeType,
        fileSize: record.fileSize,
        uploadedAt: record.uploadedAt,
        patient: {
          id: record.patient.id,
          medOrgId: record.patient.medOrgId,
          name: record.patient.name,
        },
        doctor: {
          id: record.doctor.id,
          doctorId: record.doctor.doctorId,
          name: record.doctor.name,
        },
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// View record (stream PDF from disk)
router.get("/:id/view", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    if (!fs.existsSync(record.filePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }

    // Stream the PDF inline
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${record.originalFileName}"`,
    });
    fs.createReadStream(record.filePath).pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download record (stream PDF as attachment)
router.get("/:id/download", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    if (!fs.existsSync(record.filePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }

    // Stream the PDF as download
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${record.originalFileName}"`,
    });
    fs.createReadStream(record.filePath).pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;