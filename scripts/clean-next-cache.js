const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const nextCache = path.join(projectRoot, ".next");

if (fs.existsSync(nextCache)) {
  fs.rmSync(nextCache, { recursive: true, force: true });
  console.log("Removed .next cache");
} else {
  console.log("No .next cache found");
}
