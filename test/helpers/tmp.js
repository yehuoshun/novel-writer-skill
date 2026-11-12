'use strict';
// 测试用临时目录：统一在进程退出时删掉，别在 %TEMP% 里堆上千个 nw-* 目录。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const created = [];

function sweep() {
  for (const d of created.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 删不掉就算了（Windows 上偶发占用），不要让清理把测试拖红
    }
  }
}

process.on('exit', sweep);

/** 建临时目录，进程退出时自动清理 */
function tmpDir(prefix = 'nw-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

module.exports = { tmpDir, sweep };
