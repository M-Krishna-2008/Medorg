// Reset script for MedOrg
// Wipes all data, clears uploads, and reseeds with seed data

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

import prisma from "../server/src/db/prisma";
import { generateClinicalPdf, SAMPLE_RECORD_DATA } from "./pdfHelper";

export async function resetDatabase() {
  console.log("MedOrg Database Reset");
  console.log("=".repeat(50));

  // Check production safety
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESET !== "true") {
    console.error("ERROR: Database reset is not allowed in production.");
    console.error("Set ALLOW_DB_RESET=true environment variable to enable.");
    process.exit(1);
  }

  // Wipe all data
  await prisma.session.deleteMany({});
  await prisma.accessRequest.deleteMany({});
  await prisma.medicalRecord.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.otpSession.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.doctor.deleteMany({});

  console.log("Database wiped successfully.");

  // Clear upload directories
  const dataDir = path.resolve(rootDir, "data");
  const reportsDir = path.join(dataDir, "uploads", "reports");
  const prescriptionsDir = path.join(dataDir, "uploads", "prescriptions");
  const tempDir = path.join(dataDir, "uploads", "temp");

  for (const dir of [reportsDir, prescriptionsDir, tempDir]) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
    } else {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  console.log("Uploads cleared.");

  // Re-seed patients
  const meera = await prisma.user.create({
    data: {
      medOrgId: "MED-000001",
      name: "Meera Raghavan",
      email: "meera.raghavan@example.com",
      dateOfBirth: "1985-03-15",
      nationalIdHash: crypto.createHash("sha256").update("123456789012").digest("hex"),
      nationalIdLast4: "1234",
    },
  });

  const thomas = await prisma.user.create({
    data: {
      medOrgId: "MED-000002",
      name: "Thomas Keller",
      email: "thomas.keller@example.com",
      dateOfBirth: "1970-01-01",
      nationalIdHash: crypto.createHash("sha256").update("987654321098").digest("hex"),
      nationalIdLast4: "9876",
    },
  });

  // Doctors
  const aisha = await prisma.doctor.create({
    data: {
      doctorId: "DOC-0001",
      name: "Dr. Aisha Nair",
      email: "a.nair@example.com",
      medicalLicenseNumber: "REG-2024-8841",
      hospitalName: "St. Helena Medical Center",
    },
  });

  const rafael = await prisma.doctor.create({
    data: {
      doctorId: "DOC-0002",
      name: "Dr. Rafael Ortiz",
      email: "r.ortiz@example.com",
      medicalLicenseNumber: "REG-2024-9127",
      hospitalName: "Bayview General Hospital",
    },
  });

  // Access requests
  await prisma.accessRequest.create({
    data: {
      patientId: meera.id,
      doctorId: aisha.id,
      status: "APPROVED",
      requestedAt: new Date(),
      approvedAt: new Date(),
      accessDuration: "7d",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.accessRequest.create({
    data: {
      patientId: thomas.id,
      doctorId: aisha.id,
      status: "DENIED",
      accessDuration: "7d",
      requestedAt: new Date(),
    },
  });

  await prisma.accessRequest.create({
    data: {
      patientId: meera.id,
      doctorId: aisha.id,
      status: "EXPIRED",
      accessDuration: "7d",
      requestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });

  // Welcome notifications
  await prisma.notification.create({
    data: {
      userType: "PATIENT",
      userId: meera.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your medical records are now secure with MedOrg.",
    },
  });

  await prisma.notification.create({
    data: {
      userType: "PATIENT",
      userId: thomas.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your medical records are now secure with MedOrg.",
    },
  });

  await prisma.notification.create({
    data: {
      userType: "DOCTOR",
      userId: aisha.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your doctor portal is now active.",
    },
  });

  // Real selectable PDFs
  const sampleRecords = [
    {
      patientId: meera.id,
      doctorId: aisha.id,
      recordType: "REPORT" as const,
      title: "Complete Blood Count, March Report",
      description: "Blood test results from March 2024 visit",
    },
    {
      patientId: meera.id,
      doctorId: aisha.id,
      recordType: "PRESCRIPTION" as const,
      title: "Lisinopril 10mg - Monthly Refill",
      description: "Blood pressure medication refill",
    },
    {
      patientId: thomas.id,
      doctorId: rafael.id,
      recordType: "REPORT" as const,
      title: "MRI Brain Scan Results",
      description: "Neurology follow-up from April 2024",
    },
    {
      patientId: thomas.id,
      doctorId: rafael.id,
      recordType: "PRESCRIPTION" as const,
      title: "Metformin 500mg - Daily Dosage",
      description: "Diabetes medication",
    },
  ];

  for (const recordData of sampleRecords) {
    const recordDir = recordData.recordType === "REPORT" ? reportsDir : prescriptionsDir;
    const storedFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`;
    const filePath = path.join(recordDir, storedFileName);

    const sampleConfig = SAMPLE_RECORD_DATA[recordData.title];
    let pdfBuffer: Buffer;
    if (sampleConfig) {
      pdfBuffer = await generateClinicalPdf(sampleConfig);
    } else {
      pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    }

    fs.writeFileSync(filePath, pdfBuffer);

    await prisma.medicalRecord.create({
      data: {
        patientId: recordData.patientId,
        doctorId: recordData.doctorId,
        recordType: recordData.recordType,
        title: recordData.title,
        description: recordData.description,
        originalFileName: `${recordData.title}.pdf`,
        storedFileName,
        filePath,
        mimeType: "application/pdf",
        fileSize: pdfBuffer.length,
      },
    });
  }

  console.log("Database reset and reseeded successfully!");
}

if (process.argv[1] && process.argv[1].endsWith("reset.ts")) {
  resetDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}