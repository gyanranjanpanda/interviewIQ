// Imported first by index.js so that process.env is populated before any other
// module body runs. ES module imports are hoisted, so a dotenv.config() call
// placed among the imports in index.js would execute too late.
import dotenv from "dotenv"

dotenv.config()
