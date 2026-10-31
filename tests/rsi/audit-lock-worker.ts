import { RSIAuditLog } from '../../src/rsi/audit.js';

const filePath = process.argv[2];
const mutationId = process.argv[3];

if (!filePath || !mutationId) {
  process.stderr.write('usage: audit-lock-worker <filePath> <mutationId>\n');
  process.exit(2);
}

const log = new RSIAuditLog(filePath);
await log.log({
  timestamp: new Date().toISOString(),
  action: 'mutation-applied',
  skillName: 'tdd',
  mutationId,
  hypothesis: 'cross-process append',
  metrics: {
    baseline: 0.6,
    current: 0.8,
    delta: 0.2,
  },
  decision: 'promote',
});
