require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const db = require("./db");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.set("trust proxy", 1);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";

function normalizeOrigin(origin = "") {
  return String(origin)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    const allowedOrigins = new Set([
      FRONTEND_ORIGIN,
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "http://localhost:5000",
      "http://127.0.0.1:5000"
    ].filter(Boolean).map(normalizeOrigin));

    const normalizedOrigin = normalizeOrigin(origin);
    const isRailwayOrigin = /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(normalizedOrigin);

    const isLocalhostOrigin = typeof origin === "string" && (
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    );

    if (!origin || allowedOrigins.has(normalizedOrigin) || isLocalhostOrigin || isRailwayOrigin) {
      return callback(null, true);
    }

    console.log("Blocked by CORS:", origin);
    console.log("Expected FRONTEND_ORIGIN:", FRONTEND_ORIGIN);
    return callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" }
});

const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const uploadsDir = path.join(__dirname, "uploads");
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || "no-reply@career-compass.ai";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Career Compass AI <onboarding@resend.dev>";
const frontendDir = path.join(__dirname, "..", "frontend");

app.use(express.static(frontendDir));

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

/* ================= AI ================= */
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
const model = genAI
  ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
  : null;
const mailTransporter = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  : null;

async function callGemini(prompt) {
  if (!model) return null;

  for (let i = 0; i < 3; i++) {
    try {
      const result = await model.generateContent(prompt);
      return (await result.response).text();
    } catch (err) {
      console.log("Retry Gemini:", i + 1, err.message);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  return null;
}

/* ================= DB ================= */

function runQuery(sql, params = []) {
  return db.run(sql, params);
}

function getQuery(sql, params = []) {
  return db.get(sql, params);
}

function allQuery(sql, params = []) {
  return db.all(sql, params);
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function otpExpiryTimestamp() {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

async function sendVerificationEmail(email, otp) {
  if (BREVO_API_KEY) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          email: MAIL_FROM,
          name: "Career Compass AI"
        },
        to: [{ email }],
        subject: "Career Compass AI verification code",
        textContent: `Your Career Compass AI verification code is ${otp}. It expires in 10 minutes.`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
            <h2 style="margin-bottom: 8px;">Verify your email</h2>
            <p>Your Career Compass AI verification code is:</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #d97706; margin: 18px 0;">
              ${otp}
            </div>
            <p>This code expires in 10 minutes.</p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Brevo API error: ${response.status} ${body}`);
    }

    return;
  }

  if (RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: "Career Compass AI verification code",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
            <h2 style="margin-bottom: 8px;">Verify your email</h2>
            <p>Your Career Compass AI verification code is:</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #d97706; margin: 18px 0;">
              ${otp}
            </div>
            <p>This code expires in 10 minutes.</p>
          </div>
        `,
        text: `Your Career Compass AI verification code is ${otp}. It expires in 10 minutes.`
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend error: ${response.status} ${body}`);
    }

    return;
  }

  if (!mailTransporter) {
    throw new Error("SMTP is not configured");
  }

  await mailTransporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Career Compass AI verification code",
    text: `Your Career Compass AI verification code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2 style="margin-bottom: 8px;">Verify your email</h2>
        <p>Your Career Compass AI verification code is:</p>
        <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #d97706; margin: 18px 0;">
          ${otp}
        </div>
        <p>This code expires in 10 minutes.</p>
      </div>
    `
  });
}

function parseToken(header = "") {
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return header.trim();
}

function safeArray(value) {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeReportDbRow(row) {
  if (!row) return null;

  return {
    ...row,
    jobRole: row.jobRole ?? row.jobrole ?? null,
    jobMatch: row.jobMatch ?? row.jobmatch ?? null
  };
}

function buildResponse(reportId, data) {
  return {
    reportId,
    score: data.score,
    jobMatch: data.jobMatch,
    breakdown: {
      skills: data.skillsScore,
      experience: data.experienceScore,
      format: data.formatScore
    },
    analysis: {
      good: data.good,
      bad: data.bad,
      suggestions: data.suggestions
    }
  };
}

function fallbackAnalysis() {
  return {
    score: 65,
    jobMatch: 60,
    skillsScore: 60,
    experienceScore: 60,
    formatScore: 60,
    good: ["Fallback analysis"],
    bad: ["Try again"],
    suggestions: ["Improve formatting", "Add projects", "Add metrics"],
    resumeText: "",
    enhancedResume: ""
  };
}

function normalizeAnalysis(data = {}) {
  return {
    score: Number(data.score) || 0,
    jobMatch: Number(data.jobMatch) || 0,
    skillsScore: Number(data.skillsScore) || 0,
    experienceScore: Number(data.experienceScore) || 0,
    formatScore: Number(data.formatScore) || 0,
    good: Array.isArray(data.good) ? data.good : [],
    bad: Array.isArray(data.bad) ? data.bad : [],
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    resumeText: typeof data.resumeText === "string" ? data.resumeText : "",
    enhancedResume: typeof data.enhancedResume === "string" ? data.enhancedResume : ""
  };
}

function buildEnhancedResumeFallback(resumeText, jobRole, suggestions = []) {
  const advice = suggestions.length
    ? suggestions.map(item => `- ${item}`).join("\n")
    : "- Add measurable achievements\n- Improve structure and readability\n- Tailor skills to the target role";

  return [
    "ENHANCED RESUME DRAFT",
    "",
    `Target Role: ${jobRole}`,
    "",
    "Professional Summary",
    `Candidate prepared for ${jobRole} with a focus on clearer impact, stronger keywords, and a more ATS-friendly structure.`,
    "",
    "Core Skills",
    "- Add your top technical and soft skills here",
    "- Match the wording to the job description",
    "",
    "Experience Highlights",
    "- Rewrite each project or internship with action verbs and measurable outcomes",
    "- Include tools, technologies, and business impact",
    "",
    "Projects",
    "- Add 2 to 3 strong projects with concise bullet points",
    "",
    "Education",
    "- Degree, institution, graduation year, notable coursework or achievements",
    "",
    "Suggested Improvements",
    advice,
    "",
    "Source Resume Text",
    resumeText || "Original resume text was not available."
  ].join("\n");
}

async function generateEnhancedResume(report) {
  const suggestions = safeArray(report.suggestions);
  const sourceText = report.resume_text || "";

  if (!sourceText.trim()) {
    return buildEnhancedResumeFallback(sourceText, report.jobRole || "General", suggestions);
  }

  const prompt = `
You are improving a resume for the job role "${report.jobRole || "General"}".

Rewrite the resume into a polished, ATS-friendly version.
Use plain text only.
Keep it professional and concise.
Preserve truthful content from the source resume.
Add stronger wording, clearer sections, and better bullet phrasing.

Return only the improved resume text.

Known improvement areas:
${suggestions.map(item => `- ${item}`).join("\n")}

Source resume:
${sourceText}
`;

  const aiText = await callGemini(prompt);
  if (!aiText) {
    return buildEnhancedResumeFallback(sourceText, report.jobRole || "General", suggestions);
  }

  return aiText.replace(/```text|```/g, "").trim();
}

function writeResumePdf(doc, content) {
  const lines = String(content || "").split(/\r?\n/);

  lines.forEach(line => {
    const trimmed = line.trim();

    if (!trimmed) {
      doc.moveDown(0.5);
      return;
    }

    const isHeading = trimmed.length <= 40 && !trimmed.startsWith("-") && trimmed === trimmed.toUpperCase();
    const isSection = !trimmed.startsWith("-") && trimmed.length <= 40 && /^[A-Za-z][A-Za-z\s]+$/.test(trimmed);

    if (isHeading) {
      doc.moveDown(0.6);
      doc.fontSize(16).text(trimmed, { underline: true });
      doc.moveDown(0.2);
    } else if (isSection) {
      doc.moveDown(0.4);
      doc.fontSize(13).text(trimmed);
    } else {
      doc.fontSize(11).text(trimmed);
    }
  });
}

async function saveReport(userId, filename, jobRole, data) {
  const id = crypto.randomUUID();

  await runQuery(
    `INSERT INTO reports (
      id, user_id, filename, jobRole, score, jobMatch, skills, experience,
      format, good, bad, suggestions, resume_text, enhanced_resume, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      userId,
      filename,
      jobRole,
      data.score,
      data.jobMatch,
      data.skillsScore,
      data.experienceScore,
      data.formatScore,
      JSON.stringify(data.good),
      JSON.stringify(data.bad),
      JSON.stringify(data.suggestions),
      data.resumeText || "",
      data.enhancedResume || ""
    ]
  );

  return id;
}

function formatReportRow(row) {
  const normalized = normalizeReportDbRow(row);
  if (!normalized) return null;

  return {
    ...normalized,
    good: safeArray(normalized.good),
    bad: safeArray(normalized.bad),
    suggestions: safeArray(normalized.suggestions)
  };
}

/* ================= AUTH ================= */
function auth(req, res, next) {
  const token = parseToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= AUTH ROUTES ================= */
app.post("/signup", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (!isEmailValid(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const otpExpiresAt = otpExpiryTimestamp();
    const existingUser = await getQuery("SELECT * FROM users WHERE email = ?", [email]);

    if (existingUser && existingUser.is_verified) {
      return res.status(400).json({ error: "User already exists. Please login." });
    }

    if (existingUser) {
      await runQuery(
        `UPDATE users
         SET password = ?, is_verified = 0, verification_code = ?, verification_expires_at = ?
         WHERE email = ?`,
        [hash, otp, otpExpiresAt, email]
      );
      await runQuery(
        `UPDATE users SET created_at = COALESCE(created_at, ?) WHERE email = ?`,
        [new Date().toISOString(), email]
      );
    } else {
      await runQuery(
        `INSERT INTO users (
          email, password, is_verified, verification_code, verification_expires_at, created_at
        ) VALUES (?, ?, 0, ?, ?, ?)`,
        [email, hash, otp, otpExpiresAt, new Date().toISOString()]
      );
    }

    await sendVerificationEmail(email, otp);

    res.json({
      message: "Verification code sent to your email",
      requiresVerification: true,
      email
    });
  } catch (err) {
    if (err.message === "SMTP is not configured") {
      return res.status(500).json({ error: "Email service is not configured yet" });
    }

    console.log("Signup error:", err.message);
    res.status(500).json({ error: "Unable to create account" });
  }
});

app.post("/verify-email", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code are required" });
    }

    const user = await getQuery("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.is_verified) {
      return res.json({ message: "Email already verified" });
    }

    if (!user.verification_code || user.verification_code !== code) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    if (!user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Verification code expired" });
    }

    await runQuery(
      `UPDATE users
       SET is_verified = 1, verification_code = NULL, verification_expires_at = NULL
       WHERE email = ?`,
      [email]
    );

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d"
    });

    res.json({
      message: "Email verified successfully",
      token,
      email: user.email
    });
  } catch (err) {
    console.log("Verify email error:", err.message);
    res.status(500).json({ error: "Unable to verify email" });
  }
});

app.post("/resend-verification", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await getQuery("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    const otp = generateOtp();
    const otpExpiresAt = otpExpiryTimestamp();

    await runQuery(
      `UPDATE users
       SET verification_code = ?, verification_expires_at = ?
       WHERE email = ?`,
      [otp, otpExpiresAt, email]
    );

    await sendVerificationEmail(email, otp);

    res.json({ message: "Verification code sent again" });
  } catch (err) {
    if (err.message === "SMTP is not configured") {
      return res.status(500).json({ error: "Email service is not configured yet" });
    }

    console.log("Resend verification error:", err.message);
    res.status(500).json({ error: "Unable to resend verification code" });
  }
});

app.post("/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await getQuery("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.is_verified) {
      return res.status(403).json({
        error: "Verify your email before logging in",
        requiresVerification: true,
        email
      });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Wrong password" });

    await runQuery(`UPDATE users SET last_login_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      user.id
    ]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d"
    });

    res.json({ token, email: user.email });
  } catch (err) {
    console.log("Login error:", err.message);
    res.status(500).json({ error: "Unable to login" });
  }
});

app.get("/me", auth, async (req, res) => {
  try {
    const user = await getQuery(
      `SELECT id, email, is_verified, created_at, last_login_at FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.log("Me error:", err.message);
    res.status(500).json({ error: "Failed to load user profile" });
  }
});

/* ================= ANALYSIS ================= */
app.post("/upload-resume", auth, upload.single("resume"), async (req, res) => {
  let filePath;

  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    filePath = path.resolve(req.file.path);

    if (path.extname(req.file.originalname).toLowerCase() !== ".pdf") {
      return res.status(400).json({ error: "Only PDF resumes are supported" });
    }

    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    const text = parsed.text || "";

    if (!text.trim()) {
      return res.status(400).json({ error: "Could not read text from the PDF" });
    }

    const jobRole = String(req.body.jobRole || "General").trim() || "General";
    const filename = req.file.originalname;

    const prompt = `
Analyze this resume:

${text}

Job Role: ${jobRole}

Return valid JSON only:
{
  "score": number,
  "jobMatch": number,
  "skillsScore": number,
  "experienceScore": number,
  "formatScore": number,
  "good": [],
  "bad": [],
  "suggestions": []
}
`;

    let parsedData;
    const aiText = await callGemini(prompt);

    if (aiText) {
      try {
        parsedData = normalizeAnalysis(
          JSON.parse(aiText.replace(/```json|```/g, "").trim())
        );
      } catch {
        parsedData = fallbackAnalysis();
      }
    } else {
      parsedData = fallbackAnalysis();
    }

    parsedData.resumeText = text;

    const reportId = await saveReport(req.user.id, filename, jobRole, parsedData);
    res.json(buildResponse(reportId, parsedData));
  } catch (err) {
    console.log("Upload error:", err.message);
    res.status(500).json({ error: "Failed to analyze resume" });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/* ================= HISTORY ================= */
app.get("/history", auth, async (req, res) => {
  try {
    const rows = await allQuery(
      `SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(rows.map(formatReportRow));
  } catch (err) {
    console.log("History error:", err.message);
    res.status(500).json({ error: "Failed to load history" });
  }
});

/* ================= REPORT ================= */
app.get("/report/:id", auth, async (req, res) => {
  try {
    const row = normalizeReportDbRow(await getQuery(
      `SELECT * FROM reports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    ));

    if (!row) return res.status(404).json({ error: "Report not found" });
    res.json(formatReportRow(row));
  } catch (err) {
    console.log("Report error:", err.message);
    res.status(500).json({ error: "Failed to load report" });
  }
});

/* ================= DELETE ================= */
app.delete("/delete/:id", auth, async (req, res) => {
  try {
    const result = await runQuery(
      `DELETE FROM reports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!result.changes) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.log("Delete error:", err.message);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

/* ================= PDF DOWNLOAD ================= */
app.get("/download/:id", auth, async (req, res) => {
  try {
    const row = normalizeReportDbRow(await getQuery(
      `SELECT * FROM reports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    ));

    if (!row) return res.status(404).json({ error: "Report not found" });

    const good = safeArray(row.good);
    const bad = safeArray(row.bad);
    const suggestions = safeArray(row.suggestions);
    const doc = new PDFDocument();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=report.pdf");

    doc.pipe(res);

    doc.fontSize(20).text("Career Compass AI Report", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`File: ${row.filename}`);
    doc.text(`Role: ${row.jobRole}`);
    doc.text(`Score: ${row.score}`);
    doc.text(`Job Match: ${row.jobMatch}`);
    doc.moveDown();

    doc.text("Strengths:");
    good.forEach(item => doc.text(`- ${item}`));

    doc.moveDown();
    doc.text("Weaknesses:");
    bad.forEach(item => doc.text(`- ${item}`));

    doc.moveDown();
    doc.text("AI Suggestions:");
    suggestions.forEach(item => doc.text(`- ${item}`));

    doc.end();
  } catch (err) {
    console.log("Download error:", err.message);
    res.status(500).json({ error: "Failed to download report" });
  }
});

/* ================= ENHANCED RESUME ================= */
app.post("/enhance-resume/:id", auth, async (req, res) => {
  try {
    const row = normalizeReportDbRow(await getQuery(
      `SELECT * FROM reports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    ));

    if (!row) return res.status(404).json({ error: "Report not found" });

    const enhancedResume = await generateEnhancedResume(row);

    await runQuery(`UPDATE reports SET enhanced_resume = ? WHERE id = ?`, [
      enhancedResume,
      row.id
    ]);

    res.json({
      reportId: row.id,
      enhancedResume,
      suggestions: safeArray(row.suggestions)
    });
  } catch (err) {
    console.log("Enhance resume error:", err.message);
    res.status(500).json({ error: "Failed to enhance resume" });
  }
});

app.get("/download-enhanced/:id", auth, async (req, res) => {
  try {
    const row = normalizeReportDbRow(await getQuery(
      `SELECT id, filename, jobRole, enhanced_resume FROM reports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    ));

    if (!row) return res.status(404).json({ error: "Report not found" });
    if (!row.enhanced_resume) {
      return res.status(400).json({ error: "Generate the enhanced resume first" });
    }

    const doc = new PDFDocument({ margin: 50 });
    const baseName = path.parse(row.filename || "enhanced-resume").name || "enhanced-resume";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${baseName}-enhanced.pdf"`
    );

    doc.pipe(res);
    doc.fontSize(20).text("Enhanced Resume", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Target Role: ${row.jobRole || "General"}`);
    doc.moveDown();
    writeResumePdf(doc, row.enhanced_resume);
    doc.end();
  } catch (err) {
    console.log("Enhanced download error:", err.message);
    res.status(500).json({ error: "Failed to download enhanced resume" });
  }
});

/* ================= START ================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendDir, "login.html"));
});

async function startServer() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} using ${db.dialect}`);
    });
  } catch (err) {
    console.log("Startup error:", err.message);
    process.exit(1);
  }
}

startServer();
