/**
 * ORCA-X Unified Multi-Service Development Runner
 * Launches Express (port 3000), ML Risk API (port 8000), and RAG API (port 8001) concurrently.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const processes = [];

// Determine best Python executable
function findPythonPath() {
  const candidates = [
    path.resolve(process.cwd(), isWindows ? 'venv-ml/Scripts/python.exe' : 'venv-ml/bin/python'),
    path.resolve(process.cwd(), isWindows ? 'venv/Scripts/python.exe' : 'venv/bin/python'),
    isWindows ? 'python.exe' : 'python3',
    'python',
  ];

  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return 'python';
}

const pythonBin = findPythonPath();

console.log('\n========================================================================');
console.log('🚀 STARTING ORCA-X FULL-STACK CONCURRENT SUITE');
console.log('========================================================================\n');
console.log(`• Node Version:   ${process.version}`);
console.log(`• Python Engine:  ${pythonBin}`);
console.log('• Express Port:   3000');
console.log('• ML Risk Port:   8000 (XGBoost)');
console.log('• RAG Port:       8001 (BGE-M3 + Qdrant)');
console.log('\n------------------------------------------------------------------------\n');

function launchProcess(name, command, args, prefixColor) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWindows,
    env: { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '1' }
  });

  child.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`${prefixColor}[${name}]\x1b[0m ${line}`);
    }
  });

  child.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`${prefixColor}[${name}]\x1b[0m ${line}`);
    }
  });

  child.on('close', (code) => {
    console.log(`${prefixColor}[${name}]\x1b[0m Process exited with code ${code}`);
  });

  processes.push(child);
  return child;
}

// 1. Start Express Backend
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
launchProcess('EXPRESS', npxCmd, ['tsx', 'server/app.ts'], '\x1b[36m');

// 2. Start ML FastAPI
launchProcess('ML-API', pythonBin, ['-m', 'uvicorn', 'ml.api:app', '--host', '0.0.0.0', '--port', '8000'], '\x1b[35m');

// 3. Start RAG FastAPI
launchProcess('RAG-API', pythonBin, ['-m', 'uvicorn', 'ml.rag_api:app', '--host', '0.0.0.0', '--port', '8001'], '\x1b[32m');

// Graceful termination
function cleanup() {
  console.log('\n🛑 Stopping all ORCA-X services...');
  for (const proc of processes) {
    try {
      if (isWindows && proc.pid) {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
