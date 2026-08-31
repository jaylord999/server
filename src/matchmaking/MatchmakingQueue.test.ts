import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatchmakingQueue } from './MatchmakingQueue';

test('enqueues players and rejects duplicates', () => {
  const queue = new MatchmakingQueue();
  assert.equal(queue.enqueue('p1'), true);
  assert.equal(queue.enqueue('p1'), false);
  assert.equal(queue.enqueue('p2'), true);
  assert.equal(queue.size(), 2);
  assert.equal(queue.isWaiting('p1'), true);
});

test('polls a pair in FIFO order with deterministic role assignment', () => {
  const queue = new MatchmakingQueue();
  queue.enqueue('player-a');
  queue.enqueue('player-b');

  const pair = queue.pollMatch();
  assert.equal(pair?.attackerPlayerId, 'player-a');
  assert.equal(pair?.defenderPlayerId, 'player-b');
  assert.equal(queue.size(), 0);
  assert.equal(queue.pollMatch(), null);
});

test('does not match with fewer than two players', () => {
  const queue = new MatchmakingQueue();
  queue.enqueue('only-one');
  assert.equal(queue.pollMatch(), null);
  assert.equal(queue.size(), 1);
});

test('removes a waiting player', () => {
  const queue = new MatchmakingQueue();
  queue.enqueue('p1');
  queue.enqueue('p2');

  assert.equal(queue.remove('p1'), true);
  assert.equal(queue.remove('p1'), false);
  assert.equal(queue.isWaiting('p1'), false);
  assert.equal(queue.size(), 1);

  // The remaining player cannot match alone.
  assert.equal(queue.pollMatch(), null);
});

test('peek returns the head of the queue', () => {
  const queue = new MatchmakingQueue();
  queue.enqueue('p1');
  queue.enqueue('p2');
  assert.equal(queue.peek(), 'p1');
});
