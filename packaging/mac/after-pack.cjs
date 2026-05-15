const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const productName = context.packager.appInfo.productFilename || "Multi-Agent Engine";
  const appPath = path.join(context.appOutDir, `${productName}.app`);
  const backendPath = path.join(appPath, "Contents", "Resources", "backend", "agent-engine-backend");
  const appExecutable = path.join(appPath, "Contents", "MacOS", productName);

  for (const executablePath of [appExecutable, backendPath]) {
    if (fs.existsSync(executablePath)) {
      fs.chmodSync(executablePath, 0o755);
    }
  }

  try {
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], {
      stdio: "inherit"
    });
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "inherit"
    });
  } catch (error) {
    console.warn(`[mac after-pack] ad-hoc codesign failed: ${error.message}`);
  }
};
