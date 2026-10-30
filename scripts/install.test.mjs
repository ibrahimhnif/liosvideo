import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_SH = join(ROOT, "install.sh");

test("install.sh exists and passes POSIX sh -n syntax check", () => {
  assert.equal(existsSync(INSTALL_SH), true, "install.sh should exist at repo root");
  execFileSync("sh", ["-n", INSTALL_SH], { stdio: "pipe" });
});

test("install.sh --help prints usage information", () => {
  const output = execFileSync("sh", [INSTALL_SH, "--help"], { encoding: "utf8" });
  assert.match(output, /liosvideo CLI installer/i);
  assert.match(output, /LIOSVIDEO_INSTALL_DIR/);
  assert.match(output, /LIOSVIDEO_VERSION/);
});

test("install.sh downloads, extracts, and installs liosvideo binary for macOS", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "liosvideo-install-test-"));
  try {
    const stageDir = join(tempRoot, "stage");
    const releaseDir = join(tempRoot, "releases", "download", "v0.1.1");
    const installDir = join(tempRoot, "bin");
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(releaseDir, { recursive: true });

    const dummyBinary = join(stageDir, "liosvideo");
    writeFileSync(dummyBinary, "#!/bin/sh\necho 'liosvideo 0.1.1'\n", "utf8");
    chmodSync(dummyBinary, 0o755);

    const tarball = join(releaseDir, "liosvideo-cli-macos.tar.gz");
    execFileSync("tar", ["-czf", tarball, "-C", stageDir, "liosvideo"]);

    const output = execFileSync("sh", [INSTALL_SH], {
      encoding: "utf8",
      env: {
        ...process.env,
        LIOSVIDEO_OS: "Darwin",
        LIOSVIDEO_ARCH: "arm64",
        LIOSVIDEO_VERSION: "v0.1.1",
        LIOSVIDEO_INSTALL_DIR: installDir,
        LIOSVIDEO_RELEASE_BASE_URL: `file://${join(tempRoot, "releases")}`,
      },
    });

    const installedBin = join(installDir, "liosvideo");
    assert.equal(existsSync(installedBin), true, "liosvideo binary should be installed");
    const versionOut = execFileSync(installedBin, ["--version"], { encoding: "utf8" }).trim();
    assert.equal(versionOut, "liosvideo 0.1.1");
    assert.match(output, /Successfully installed liosvideo/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install.sh supports --version and --install-dir CLI flags on Linux x86_64", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "liosvideo-install-linux-"));
  try {
    const stageDir = join(tempRoot, "stage");
    const releaseDir = join(tempRoot, "releases", "download", "v0.2.0");
    const installDir = join(tempRoot, "custom-bin");
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(releaseDir, { recursive: true });

    const dummyBinary = join(stageDir, "liosvideo");
    writeFileSync(dummyBinary, "#!/bin/sh\necho 'liosvideo 0.2.0'\n", "utf8");
    chmodSync(dummyBinary, 0o755);

    const tarball = join(releaseDir, "liosvideo-cli-linux-x64.tar.gz");
    execFileSync("tar", ["-czf", tarball, "-C", stageDir, "liosvideo"]);

    execFileSync("sh", [INSTALL_SH, "--version", "0.2.0", "--install-dir", installDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        LIOSVIDEO_OS: "Linux",
        LIOSVIDEO_ARCH: "x86_64",
        LIOSVIDEO_RELEASE_BASE_URL: `file://${join(tempRoot, "releases")}`,
      },
    });

    const installedBin = join(installDir, "liosvideo");
    assert.equal(existsSync(installedBin), true, "liosvideo binary should be installed");
    const versionOut = execFileSync(installedBin, ["--version"], { encoding: "utf8" }).trim();
    assert.equal(versionOut, "liosvideo 0.2.0");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install.sh fails cleanly on unsupported platform", () => {
  assert.throws(
    () => {
      execFileSync("sh", [INSTALL_SH], {
        encoding: "utf8",
        stdio: "pipe",
        env: {
          ...process.env,
          LIOSVIDEO_OS: "FreeBSD",
          LIOSVIDEO_ARCH: "x86_64",
        },
      });
    },
    /Unsupported operating system/i
  );
});
