// Unit tests for the pure Speaking Manager logic (no Discord/DB required).
// Run with: npm run test:speaking
import assert from 'node:assert/strict';
import {
  DEFAULT_SPEAKING_SETTINGS,
  durationForKind,
  formatClock,
  parseDuration,
  sortQueue,
  type SpeakingEntry,
} from '../src/amongus/speaking/types.js';
import { remainingFrom } from '../src/amongus/speaking/engine.js';
import { decideRestoreAction, decideVoiceAction } from '../src/amongus/voiceLogic.js';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✅ ${name}`);
}

console.log('🧪 Speaking Manager — pure logic tests');

test('valid duration inputs are accepted', () => {
  assert.equal(parseDuration('30'), 30);
  assert.equal(parseDuration('5'), 5);
  assert.equal(parseDuration('300'), 300);
});

test('invalid duration inputs are rejected', () => {
  for (const bad of ['0', '4', '301', '-10', '12.5', 'abc', '', '  ', '1e2']) {
    assert.equal(parseDuration(bad), null, `expected "${bad}" to be invalid`);
  }
});

test('defaults match the requested values', () => {
  assert.equal(DEFAULT_SPEAKING_SETTINGS.roundRobinSeconds, 30);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.openDiscussionSeconds, 20);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.quickInterjectionSeconds, 10);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.extensionSeconds, 10);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.enabled, false);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.mandatoryRoundRobin, true);
  assert.equal(DEFAULT_SPEAKING_SETTINGS.quickEnabled, true);
});

test('duration is selected by request kind', () => {
  const settings = { guildId: 'g', ...DEFAULT_SPEAKING_SETTINGS, updatedAt: 0 };
  assert.equal(durationForKind(settings, 'round_robin'), 30);
  assert.equal(durationForKind(settings, 'open'), 20);
  assert.equal(durationForKind(settings, 'quick'), 10);
});

test('queue is FIFO by request time', () => {
  const entry = (userId: string, requestedAt: number): SpeakingEntry => ({
    userId,
    requestedAt,
    requestedBy: userId,
    kind: 'open',
  });
  const shuffled = [entry('c', 30), entry('a', 10), entry('b', 20)];
  assert.deepEqual(sortQueue(shuffled).map((e) => e.userId), ['a', 'b', 'c']);
  assert.equal(shuffled[0].userId, 'c', 'sortQueue must not mutate the input');
});

test('clock formatting is stable', () => {
  assert.equal(formatClock(24_000), '00:24');
  assert.equal(formatClock(65_400), '01:06');
  assert.equal(formatClock(-1), '00:00');
});

test('remaining time comes from an absolute timestamp', () => {
  const now = 1_000_000;
  assert.equal(remainingFrom(now + 30_000, 0, now), 30_000);
  assert.equal(remainingFrom(null, 12_000, now), 12_000);
  assert.equal(remainingFrom(now - 5_000, 0, now), 0);
});

test('extension adds to the deadline without resetting the turn', () => {
  const now = 1_000_000;
  const endsAt = now + 20_000;
  assert.equal(remainingFrom(endsAt + 10_000, 0, now), 30_000);
});

test('voice safety never unmutes originally muted or externally overridden members', () => {
  assert.equal(
    decideVoiceAction({
      shouldMute: false,
      currentServerMute: true,
      originalServerMute: true,
      botManagedMute: true,
      externalOverride: false,
    }).action,
    'none',
  );
  assert.equal(
    decideVoiceAction({
      shouldMute: false,
      currentServerMute: true,
      originalServerMute: false,
      botManagedMute: true,
      externalOverride: true,
    }).action,
    'none',
  );
  assert.equal(
    decideVoiceAction({
      shouldMute: false,
      currentServerMute: true,
      originalServerMute: false,
      botManagedMute: true,
      externalOverride: false,
    }).action,
    'unmute',
  );
  assert.equal(
    decideRestoreAction({
      currentServerMute: true,
      originalServerMute: false,
      botManagedMute: false,
      externalOverride: false,
    }).action,
    'none',
  );
});

console.log(`\n✅ ${passed} Speaking Manager logic tests passed.`);
