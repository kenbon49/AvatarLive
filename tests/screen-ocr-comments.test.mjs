import assert from 'node:assert/strict';
import test from 'node:test';

import { extractOcrComments, newOcrComments } from '../src/lib/screen-ocr-comments.ts';

test('extracts visible comment lines without capture controls', () => {
  assert.deepEqual(extractOcrComments('评论\n小明：这个多少钱？\n18:32\n可以发货吗\n发送'), [
    '小明：这个多少钱？',
    '可以发货吗',
  ]);
});

test('deduplicates OCR variations within a short window and accepts later repeats', () => {
  const seen = new Map();
  assert.deepEqual(newOcrComments(['怎么购买？', '怎么购买?'], seen, 100_000), ['怎么购买？']);
  assert.deepEqual(newOcrComments(['怎么购买？'], seen, 110_000), []);
  assert.deepEqual(newOcrComments(['怎么购买？'], seen, 180_000), []);
  assert.deepEqual(newOcrComments(['怎么购买？'], seen, 200_001), []);
  assert.deepEqual(newOcrComments(['怎么购买？'], seen, 300_002), ['怎么购买？']);
});
