const fs = require('fs');
const path = require('path');

function getReleaseNotes(targetVersion) {
  const root = path.resolve(__dirname, '..');
  const pkgPath = path.join(root, 'package.json');
  const changelogPath = path.join(root, 'CHANGELOG.md');

  let version = targetVersion;
  if (!version && fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = pkg.version;
  }
  if (!version) version = '3.7.1';
  version = version.replace(/^v/i, '');

  if (!fs.existsSync(changelogPath)) {
    return `## 🚀 Lumen Acadêmico v${version}\n\n- Atualizações e melhorias gerais de estabilidade.\n`;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const lines = content.split('\n');

  // Look for header like "## [3.7.1]" or first "## ["
  let startIndex = -1;
  const versionRegex = new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`, 'i');

  for (let i = 0; i < lines.length; i++) {
    if (versionRegex.test(lines[i].trim())) {
      startIndex = i;
      break;
    }
  }

  // If specific version not found, grab the first "## [" version section
  if (startIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s*\[\d+\.\d+\.\d+\]/.test(lines[i].trim())) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) {
    return `## 🚀 Lumen Acadêmico v${version}\n\n- Atualizações e melhorias gerais de estabilidade.\n`;
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##\s*\[/.test(line)) {
      endIndex = i;
      break;
    }
  }

  let notes = lines.slice(startIndex, endIndex).join('\n').trim();

  // Strip trailing "---" if present
  notes = notes.replace(/\n\s*---\s*$/, '').trim();

  return `${notes}

---
> 💡 *Para consultar o histórico de versões anteriores, acesse o [CHANGELOG.md](https://github.com/jonathancollars-ops/organiza/blob/main/CHANGELOG.md).*
`;
}

if (require.main === module) {
  const versionArg = process.argv[2];
  const targetFile = process.argv[3];
  const notes = getReleaseNotes(versionArg);

  if (targetFile) {
    fs.writeFileSync(path.resolve(targetFile), notes, 'utf8');
    console.log(`✅ Release notes written to ${targetFile}`);
  } else {
    process.stdout.write(notes);
  }
}

module.exports = { getReleaseNotes };
