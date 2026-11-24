'use strict';
// Deletes the local `wrangler dev` state, which includes every room and the room-creation rate limit.
// Run it only while the dev server is stopped.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const STATE_DIR = path.join(__dirname, '..', '.wrangler', 'state');
const DEV_SERVER_PORT = 8787;

function isDevServerRunning() {
  return new Promise((resolve) => {
    const socket = net.connect(DEV_SERVER_PORT, 'localhost');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  if (await isDevServerRunning()) {
    console.error('The dev server is running on port ' + DEV_SERVER_PORT + '. Stop it, then run this again.');
    process.exit(1);
  }
  if (!fs.existsSync(STATE_DIR)) {
    console.log('No local room state to delete.');
    return;
  }
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  console.log('Deleted local room state.');
}

main();
