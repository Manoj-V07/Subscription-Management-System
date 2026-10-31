const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, '..', 'dist', 'web');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js']) {
  fs.copyFileSync(path.join(__dirname, '..', 'apps', 'web', file), path.join(output, file));
}
console.log(`Built web assets to ${output}`);
