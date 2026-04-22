/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const cwd = join(__dirname, '../../');
const storagePath = join(cwd, 'build/configs/storage.json');

const readStorageBackup = () => {
  if (!fs.existsSync(storagePath)) return null;

  const content = fs.readFileSync(storagePath, 'utf8');
  try {
    const data = JSON.parse(content);
    return Array.isArray(data.users) && data.users.length > 0 ? content : null;
  } catch (error) {
    return null;
  }
};

const restoreStorageBackup = (backup) => {
  if (!backup) return;
  fs.mkdirSync(join(cwd, 'build/configs'), { recursive: true });
  fs.writeFileSync(storagePath, backup, 'utf8');
  console.log('Preserved build/configs/storage.json');
};

const backup = readStorageBackup();

try {
  execSync('tsc', { cwd, windowsHide: true, stdio: 'inherit' });
  execSync('node ./src/scripts/cplibs.js', { cwd, windowsHide: true, stdio: 'inherit' });
  restoreStorageBackup(backup);
} catch (error) {
  restoreStorageBackup(backup);
  throw error;
}
