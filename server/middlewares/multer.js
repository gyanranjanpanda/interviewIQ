import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve relative to this file, not the process cwd, so uploads land in the
// same place no matter where the server is started from.
const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        // Strip path separators and anything unusual out of the client-supplied name.
        const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}-${safeName}`)
    }
})

export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        if (file.mimetype !== "application/pdf") {
            return cb(new Error("Only PDF resumes are supported."));
        }
        cb(null, true);
    },
});

/**
 * Turns multer failures (file too large, wrong type) into JSON responses.
 * Without this they fall through to Express' HTML error page, which the
 * frontend cannot read a message out of.
 */
export const handleUploadErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "Resume must be smaller than 5MB." });
        }
        return res.status(400).json({ message: `Upload failed: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ message: err.message || "Upload failed." });
    }
    next();
};
