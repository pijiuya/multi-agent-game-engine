const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const frontendDir = path.join(repoRoot, "frontend");
const releaseDir = path.join(frontendDir, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(frontendDir, "package.json"), "utf8"));
const kitDir = path.join(releaseDir, `Multi-Agent-Engine-${packageJson.version}-mac-install-kit`);

fs.rmSync(kitDir, { recursive: true, force: true });
fs.mkdirSync(kitDir, { recursive: true });

const artifacts = fs
  .readdirSync(releaseDir)
  .filter((name) => /^Multi-Agent Engine-.*-mac-.*\.dmg$/.test(name))
  .sort();

if (artifacts.length === 0) {
  throw new Error("No mac DMG artifact found in frontend/release");
}

for (const artifact of artifacts) {
  fs.copyFileSync(path.join(releaseDir, artifact), path.join(kitDir, artifact));
}

const helperSource = path.join(repoRoot, "packaging", "mac", "install-multi-agent-engine.command");
const helperTarget = path.join(kitDir, "install-multi-agent-engine.command");
fs.copyFileSync(helperSource, helperTarget);
fs.chmodSync(helperTarget, 0o755);

const docs = [
  ["docs/mac-installation.zh-CN.md", "README-mac-installation.zh-CN.md"],
  ["docs/user-manual.zh-CN.md", "user-manual.zh-CN.md"]
];
for (const [source, target] of docs) {
  fs.copyFileSync(path.join(repoRoot, source), path.join(kitDir, target));
}

const checksumLines = [];
for (const artifact of artifacts) {
  const filePath = path.join(kitDir, artifact);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  checksumLines.push(`${digest}  ${artifact}`);
}
fs.writeFileSync(path.join(kitDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`Created mac install kit: ${kitDir}`);
