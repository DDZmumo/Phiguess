import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctHealthGain } from '../packages/contracts/src';
import { performanceBadge, performanceBadgeTotals, scoreAnswer, SONG_MAX_SCORE } from '../packages/game-core/src';

test('tutorial scoring rules use additive penalties and preserve the timeout boundary', () => {
  for (const difficulty of ['ez', 'hd', 'in', 'at'] as const) {
    const maximum = SONG_MAX_SCORE[difficulty];
    assert.equal(scoreAnswer(difficulty, 5_000, 30_000), maximum);
    assert.equal(scoreAnswer(difficulty, 17_500, 30_000, 1), maximum * .65);
    assert.equal(scoreAnswer(difficulty, 5_000, 30_000, 5), maximum / 2);
    assert.equal(scoreAnswer(difficulty, 5_000, 30_000, 6), maximum / 2);
    assert.equal(scoreAnswer(difficulty, 29_999, 30_000), maximum / 2);
    assert.equal(scoreAnswer(difficulty, 30_000, 30_000), 0);
  }
});

test('third hint lowers earned score while the original difficulty remains the badge denominator', () => {
  assert.deepEqual([0, 1, 2, 3].map(correctHealthGain), [5, 3, 2, 1]);
  for (const [difficulty,lower] of [['hd','ez'],['in','hd'],['at','in']] as const) {
    assert.equal(scoreAnswer(difficulty, 5_000, 30_000, 0, false),SONG_MAX_SCORE[difficulty]);
    assert.equal(scoreAnswer(difficulty, 5_000, 30_000, 0, true),SONG_MAX_SCORE[lower]);
    const score=scoreAnswer(difficulty,17_500,30_000,1,true);
    assert.equal(score,SONG_MAX_SCORE[lower]*.65);
    const badge=performanceBadge([{correct:true,score}],difficulty);
    assert.equal(badge.maximum,SONG_MAX_SCORE[difficulty]);
    assert.equal(badge.ratio,score/SONG_MAX_SCORE[difficulty]);
  }
  assert.equal(scoreAnswer('ez',5_000,30_000,0,true),500);
  assert.equal(scoreAnswer('at',30_000,30_000,0,true),0);
});

test('tutorial missed-song comparison leaves both badge denominator and correct count unchanged', () => {
  const correct = [{ correct: true, score: 1900 }, { correct: true, score: 1900 }];
  const missed = Array.from({ length: 3 }, () => ({ correct: false, score: 0 }));
  const original = performanceBadge(correct, 'in');
  assert.deepEqual(performanceBadge([...correct, ...missed], 'in'), original);
  assert.deepEqual(original, performanceBadgeTotals(3800, 2, 'in'));
  assert.equal(original.maximum, 4000);
  assert.equal(original.grade, 'gold');
  assert.equal(performanceBadgeTotals(0, 0, 'in').grade, 'none');
});

test('tutorial badge thresholds match every difficulty including no-badge range', () => {
  for (const difficulty of ['ez', 'hd', 'in', 'at'] as const) {
    for (const [rate, grade] of [[100, 'rainbow'], [95, 'gold'], [90, 'red'], [80, 'blue'], [70, 'green'], [69, 'none']] as const) {
      const maximum = SONG_MAX_SCORE[difficulty] * 2;
      const badge = performanceBadgeTotals(maximum * rate / 100, 2, difficulty);
      assert.equal(badge.grade, grade);
      assert.equal(badge.correct, 2);
      assert.equal(badge.ratio, rate / 100);
    }
  }
});
