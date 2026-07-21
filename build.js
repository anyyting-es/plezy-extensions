const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Output file name
const OUTPUT_FILE = 'index.json';
const EXTENSIONS_DIR = 'extensions';

// Helper to execute terminal commands safely
function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

// Parse Git remote URL into GitHub https URL structure
function getGitInfo() {
  const remote = runCmd('git config --get remote.origin.url');
  let branch = runCmd('git rev-parse --abbrev-ref HEAD') || 'main';
  
  if (branch === 'HEAD') {
    branch = 'main'; // Fallback if detached
  }

  if (!remote) {
    return { owner: null, repo: null, branch, isGitHub: false };
  }

  // Handle SSH format (git@github.com:owner/repo.git)
  // or HTTPS format (https://github.com/owner/repo.git)
  let owner = null;
  let repoName = null;
  let isGitHub = false;

  const githubMatch = remote.match(/github\.com[:/]([^/]+)\/([^.]+)(?:\.git)?/);
  if (githubMatch) {
    owner = githubMatch[1];
    repoName = githubMatch[2].replace(/\.git$/, '');
    isGitHub = true;
  }

  return { owner, repo: repoName, branch, isGitHub };
}

// Recursively find files matching a name in a directory
function findFiles(dir, filename, results = []) {
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      findFiles(filePath, filename, results);
    } else if (file === filename) {
      results.push(filePath);
    }
  }
  return results;
}

function build() {
  console.log('⚡ Building Plezy Extensions Index...');
  
  const gitInfo = getGitInfo();
  if (gitInfo.isGitHub) {
    console.log(`📡 Git detected: GitHub Repository: ${gitInfo.owner}/${gitInfo.repo} on branch "${gitInfo.branch}"`);
  } else {
    console.log('⚠️  No GitHub remote detected. Relative paths will be used where possible.');
  }

  const manifests = findFiles(EXTENSIONS_DIR, 'manifest.json');
  console.log(`🔍 Found ${manifests.length} extensions.`);

  const index = [];

  for (const manifestPath of manifests) {
    const dirPath = path.dirname(manifestPath);
    
    let manifest;
    try {
      const data = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(data);
    } catch (err) {
      console.error(`❌ Error parsing manifest at ${manifestPath}:`, err.message);
      process.exit(1);
    }

    // Validate manifest schema
    const requiredFields = ['id', 'name', 'version', 'type', 'language', 'code'];
    for (const field of requiredFields) {
      if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
        console.error(`❌ Validation failed in ${manifestPath}: Missing required field "${field}"`);
        process.exit(1);
      }
    }

    // Validate type
    const validTypes = ['online', 'torrent', 'manga'];
    if (!validTypes.includes(manifest.type)) {
      console.error(`❌ Validation failed in ${manifestPath}: Invalid type "${manifest.type}". Must be one of ${validTypes.join(', ')}`);
      process.exit(1);
    }

    // Verify code file exists
    const codeFilePath = path.join(dirPath, manifest.code);
    if (!fs.existsSync(codeFilePath)) {
      console.error(`❌ Validation failed in ${manifestPath}: Code file "${manifest.code}" not found in directory.`);
      process.exit(1);
    }

    // Resolve relative path from root of repository
    const relativeCodePath = path.relative('.', codeFilePath).replace(/\\/g, '/');

    // Resolve absolute URL for code and icon
    let resolvedCode = relativeCodePath;
    let resolvedIcon = manifest.icon || '';

    if (gitInfo.isGitHub) {
      const baseRawUrl = `https://raw.githubusercontent.com/${gitInfo.owner}/${gitInfo.repo}/${gitInfo.branch}`;
      resolvedCode = `${baseRawUrl}/${relativeCodePath}`;

      if (resolvedIcon && !resolvedIcon.startsWith('http')) {
        // Resolve local icon path (e.g. icon.png or ./icon.png)
        const localIconPath = path.join(dirPath, resolvedIcon);
        if (fs.existsSync(localIconPath)) {
          const relativeIconPath = path.relative('.', localIconPath).replace(/\\/g, '/');
          resolvedIcon = `${baseRawUrl}/${relativeIconPath}`;
        } else {
          console.warn(`⚠️  Warning in ${manifest.id}: Local icon "${resolvedIcon}" was declared but file was not found.`);
        }
      }
    } else {
      // Fallback for code resolving relative path
      resolvedCode = relativeCodePath;
      if (resolvedIcon && !resolvedIcon.startsWith('http')) {
        console.warn(`⚠️  Warning in ${manifest.id}: Local icon "${resolvedIcon}" is declared, but cannot be resolved to HTTP without a GitHub remote. Plezy UI needs HTTP urls for icons.`);
      }
    }

    // Construct the entry for index.json
    const entry = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      type: manifest.type,
      language: manifest.language,
      dub: !!manifest.dub,
      sub: !!manifest.sub,
      code: resolvedCode,
      icon: resolvedIcon
    };

    index.push(entry);
    console.log(`✅ Loaded & verified: ${manifest.name} (${manifest.type} - ${manifest.language}) [v${manifest.version}]`);
  }

  // Write index.json
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2), 'utf8');
  console.log(`\n🎉 Built successfully! Output written to: ${OUTPUT_FILE}`);
  console.log(`📁 Structured ${index.length} extensions.`);
}

build();
