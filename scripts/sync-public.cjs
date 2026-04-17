/**
 * Copies root index.html and built demo assets into public/ for Vercel
 * (Output Directory "public"). Local demo flow still uses demo/ directly.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pub = path.join(root, "public");
const pubDemo = path.join(pub, "demo");

fs.mkdirSync(pubDemo, { recursive: true });

const demoFiles = ["vwc-matrix-demo.css", "vwc-matrix-demo.bundle.js"];
for (const f of demoFiles) {
  const src = path.join(root, "demo", f);
  const dst = path.join(pubDemo, f);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}; run npm run build:demo first.`);
    process.exit(1);
  }
  fs.copyFileSync(src, dst);
}

const indexSrc = path.join(root, "index.html");
const indexDst = path.join(pub, "index.html");
if (!fs.existsSync(indexSrc)) {
  console.error("Missing root index.html");
  process.exit(1);
}
fs.copyFileSync(indexSrc, indexDst);
console.log("Synced index.html and demo bundle to public/");
