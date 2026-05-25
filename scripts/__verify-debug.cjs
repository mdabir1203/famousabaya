'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const m = require('../shared/snapshot-manifest.cjs');
const r = m.verifyManifest({ dir: path.join(__dirname, '..', 'data', 'sqlite-snapshots') });
console.log('ok=' + r.ok + ' total=' + r.total + ' errors=' + r.errors.length);
console.log(JSON.stringify(r.errors, null, 2));
process.exit(r.ok ? 0 : 2);
