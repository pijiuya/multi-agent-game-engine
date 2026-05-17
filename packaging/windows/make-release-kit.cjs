const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const frontendDir = path.join(repoRoot, "frontend");
const releaseDir = path.join(frontendDir, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(frontendDir, "package.json"), "utf8"));
const version = packageJson.version;
const kitDir = path.join(releaseDir, `Multi-Agent-Engine-${version}-win-install-kit`);

fs.rmSync(kitDir, { recursive: true, force: true });
fs.mkdirSync(kitDir, { recursive: true });

const expectedArtifacts = [
  `Multi-Agent Engine-${version}-win-installer-x64.exe`,
  `Multi-Agent Engine-${version}-win-portable-x64.exe`
];

const copiedArtifacts = [];
for (const artifact of expectedArtifacts) {
  const source = path.join(releaseDir, artifact);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing Windows artifact: ${source}`);
  }
  fs.copyFileSync(source, path.join(kitDir, artifact));
  copiedArtifacts.push(artifact);
}

const docs = [
  ["docs/windows-installation.zh-CN.md", "README-windows-installation.zh-CN.md"],
  ["docs/user-manual.zh-CN.md", "user-manual.zh-CN.md"]
];
for (const [source, target] of docs) {
  fs.copyFileSync(path.join(repoRoot, source), path.join(kitDir, target));
}

const checksumLines = copiedArtifacts.map((artifact) => {
  const filePath = path.join(kitDir, artifact);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return `${digest}  ${artifact}`;
});
fs.writeFileSync(path.join(kitDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`Created Windows install kit: ${kitDir}`);
