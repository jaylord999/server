import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatchmakingQueue } from './MatchmakingQueue';

test('search adds a searching (attacker) player and rejects duplicates', () => {
  const queue = new MatchmakingQueue();
  assert.equal(queue.search('p1'), true);
  assert.equal(queue.search('p1'), false);
  assert.equal(queue.search('p2'), true);
  assert.equal(queue.size(), 2);
  assert.equal(queue.isSearching('p1'), true);
  assert.equal(queue.isSearching('nobody'), false);
});

test('enqueue aliases search for compatibility', () => {
  const queue = new MatchmakingQueue();
  assert.equal(queue.enqueue('p1'), true);
  assert.equal(queue.enqueue('p1'), false);
  assert.equal(queue.isWaiting('p1'), true);
});

test('waiting() returns a FIFO snapshot of the searching players', () => {
  const queue = new MatchmakingQueue();
  queue.search('player-a');
  queue.search('player-b');
  queue.search('player-c');
  assert.deepEqual(queue.waiting(), ['player-a', 'player-b', 'player-c']);
});

test('cancel removes a searching player', () => {
  const queue = new MatchmakingQueue();
  queue.search('p1');
  queue.search('p2');

  assert.equal(queue.cancel('p1'), true);
  assert.equal(queue.cancel('p1'), false); // already removed
  assert.equal(queue.isSearching('p1'), false);
  assert.equal(queue.size(), 1);
  assert.deepEqual(queue.waiting(), ['p2']);
});

test('remove aliases cancel for compatibility', () => {
  const queue = new MatchmakingQueue();
  queue.search('p1');
  assert.equal(queue.remove('p1'), true);
  assert.equal(queue.size(), 0);
});

test('a single waiting attacker does not auto-match (no defender in this class)', () => {
  // This queue only holds searching attackers; matching happens in main.ts
  // against available defenders, so there is no pollMatch() here anymore.
  const queue = new MatchmakingQueue();
  queue.search('only-one');
  assert.equal(queue.size(), 1);
  assert.deepEqual(queue.waiting(), ['only-one']);
});

