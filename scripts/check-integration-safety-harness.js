import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const integrationDir = path.join(projectRoot, "tests", "integration");

function getIntegrationTestFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith(".test.js"))
    .map((fileName) => path.join(dirPath, fileName));
}

function validateFile(filePath) {
  const contents = fs.readFileSync(filePath, "utf8");
  const relativePath = path.relative(projectRoot, filePath).replaceAll("\\", "/");

  const hasHarnessImport =
    contents.includes('from "./safety-harness.js"') ||
    contents.includes("from './safety-harness.js'");

  const hasOptInCall = /\brequireProdTestOptIn\s*\(\s*\)/.test(contents);

  const errors = [];

  if (!hasHarnessImport) {
    errors.push(`${relativePath}: missing import from ./safety-harness.js`);
  }

  if (!hasOptInCall) {
    errors.push(`${relativePath}: missing requireProdTestOptIn() call`);
  }

  return errors;
}

const testFiles = getIntegrationTestFiles(integrationDir);
const allErrors = testFiles.flatMap((filePath) => validateFile(filePath));

if (allErrors.length > 0) {
  console.error("Integration safety harness check failed:\n");
  allErrors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Integration safety harness check passed (${testFiles.length} files).`);
