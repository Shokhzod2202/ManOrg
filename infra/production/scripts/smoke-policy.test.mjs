import assert from 'node:assert/strict';
import test from 'node:test';
import { forbiddenSyntheticId, syntheticBlockReason } from './smoke-policy.mjs';

const liveToken = '9193524838:LIVE-TOKEN-NOT-USED-FOR-SIGN-IN-0001';
const testToken = '1000000000:TESTONLYTELEGRAMBOTTOKENVALUE00001';

test('synthetic sign-in is refused without a separate test token', () => {
  const reason = syntheticBlockReason({
    liveBotToken: liveToken,
    testBotToken: '',
    baseUrl: 'http://127.0.0.1:3999',
    liveEdgePort: '4317',
  });
  assert.match(reason, /SMOKE_TEST_BOT_TOKEN/);
});

test('synthetic sign-in is refused when the test token is the live token', () => {
  const reason = syntheticBlockReason({
    liveBotToken: liveToken,
    testBotToken: liveToken,
    baseUrl: 'http://127.0.0.1:3999',
    liveEdgePort: '4317',
  });
  assert.match(reason, /live bot token/);
});

test('synthetic sign-in is refused against the public host and the live edge', () => {
  assert.match(
    syntheticBlockReason({
      liveBotToken: liveToken,
      testBotToken: testToken,
      baseUrl: 'https://bakery.haydar.store',
      liveEdgePort: '443',
    }),
    /public bakery/,
  );
  assert.match(
    syntheticBlockReason({
      liveBotToken: liveToken,
      testBotToken: testToken,
      baseUrl: 'http://127.0.0.1:4317',
      liveEdgePort: '4317',
    }),
    /live edge/,
  );
});

test('synthetic sign-in is allowed only on an isolated base with a different token', () => {
  assert.equal(
    syntheticBlockReason({
      liveBotToken: liveToken,
      testBotToken: testToken,
      baseUrl: 'http://127.0.0.1:3999',
      liveEdgePort: '4317',
    }),
    null,
  );
});

test('synthetic identities cannot be the configured owner or the old smoke employee', () => {
  assert.match(forbiddenSyntheticId(5220814834, []), /5220814834/);
  assert.match(forbiddenSyntheticId(4242424242, []), /4242424242/);
  assert.match(forbiddenSyntheticId(9100000002, ['9100000002']), /9100000002/);
  assert.equal(forbiddenSyntheticId(9100000001, ['9100000002']), null);
});
