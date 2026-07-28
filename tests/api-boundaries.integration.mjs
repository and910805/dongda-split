import 'dotenv/config.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const runId = crypto.randomUUID().slice(0, 8);
const qaPrefix = `QA_API_REGRESSION_${runId}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function request(path, {
  cookie,
  method = 'GET',
  body,
  rawBody,
  headers = {},
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : rawBody,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

function sessionCookie(response) {
  const setCookie = response.headers.getSetCookie?.()[0]
    || response.headers.get('set-cookie')
    || '';
  return setCookie.split(';')[0];
}

async function login(name) {
  const response = await request('/api/dev-login', {
    method: 'POST',
    body: { name },
  });
  assert.equal(response.status, 200, '整合測試需要啟用本機 dev-login');
  const cookie = sessionCookie(response);
  const profile = await request('/api/me', { cookie });
  assert.equal(profile.status, 200);
  return { cookie, user: profile.data };
}

test('API 邊界與支出冪等回歸測試', async t => {
  const createdGroupIds = new Set();
  let actor = null;

  const rememberGroup = response => {
    if (response?.data?.id) createdGroupIds.add(String(response.data.id));
    return response;
  };

  try {
    actor = await login(`${qaPrefix}_OWNER`);
    const groupResponse = rememberGroup(await request('/api/groups', {
      cookie: actor.cookie,
      method: 'POST',
      body: {
        name: `${qaPrefix}_GROUP`,
        description: qaPrefix,
        currency: 'TWD',
      },
    }));
    assert.equal(groupResponse.status, 201);
    const group = groupResponse.data;

    await t.test('App shell 提供 CSP 與基本安全標頭', async () => {
      const shell = await request('/app');
      assert.equal(shell.status, 200);
      const csp = shell.headers.get('content-security-policy') || '';
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(shell.headers.get('x-powered-by'), null);
    });

    await t.test('無效群組 UUID 一律回傳 400，而不是資料庫 500', async () => {
      const invalidGet = await request('/api/groups/not-a-uuid', {
        cookie: actor.cookie,
      });
      assert.equal(invalidGet.status, 400);

      const invalidCreateExpense = await request('/api/groups/not-a-uuid/expenses', {
        cookie: actor.cookie,
        method: 'POST',
        body: {
          title: `${qaPrefix}_INVALID_UUID`,
          currency: 'TWD',
          amount: '100',
          payerId: actor.user.id,
          participantIds: [actor.user.id],
          splitMode: 'equal',
        },
      });
      assert.equal(invalidCreateExpense.status, 400);

      const invalidDelete = await request('/api/groups/not-a-uuid', {
        cookie: actor.cookie,
        method: 'DELETE',
      });
      assert.equal(invalidDelete.status, 400);
    });

    await t.test('malformed JSON 回傳 400', async () => {
      const response = await request('/api/groups', {
        cookie: actor.cookie,
        method: 'POST',
        rawBody: '{"name":',
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(response.status, 400);
    });

    await t.test('超過 64KB 的 JSON 回傳 413', async () => {
      const payload = JSON.stringify({
        name: `${qaPrefix}_${'x'.repeat(70 * 1024)}`,
      });
      const response = await request('/api/groups', {
        cookie: actor.cookie,
        method: 'POST',
        rawBody: payload,
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(response.status, 413);
    });

    await t.test('群組 name 非字串時回傳 400', async () => {
      const candidates = [
        { value: `${qaPrefix}_OBJECT` },
        [`${qaPrefix}_ARRAY`],
        12345,
      ];
      for (const name of candidates) {
        const response = rememberGroup(await request('/api/groups', {
          cookie: actor.cookie,
          method: 'POST',
          body: {
            name,
            description: qaPrefix,
            currency: 'TWD',
          },
        }));
        assert.equal(response.status, 400);
      }
    });

    await t.test('群組 description 非字串時回傳 400', async () => {
      const candidates = [
        { value: `${qaPrefix}_OBJECT` },
        [`${qaPrefix}_ARRAY`],
        12345,
      ];
      for (const description of candidates) {
        const response = rememberGroup(await request('/api/groups', {
          cookie: actor.cookie,
          method: 'POST',
          body: {
            name: `${qaPrefix}_DESCRIPTION_TYPE`,
            description,
            currency: 'TWD',
          },
        }));
        assert.equal(response.status, 400);
      }
    });

    const idempotentExpenseBody = title => ({
      title,
      currency: 'TWD',
      amount: '1000',
      payerId: actor.user.id,
      participantIds: [actor.user.id],
      splitMode: 'equal',
    });

    await t.test('相同 Idempotency-Key 併發送出只建立一筆支出', async () => {
      const idempotencyKey = `${qaPrefix}_${crypto.randomUUID()}`;
      const title = `${qaPrefix}_IDEMPOTENT_EXPENSE`;
      const expenseBody = idempotentExpenseBody(title);

      const responses = await Promise.all([
        request(`/api/groups/${group.id}/expenses`, {
          cookie: actor.cookie,
          method: 'POST',
          body: expenseBody,
          headers: { 'idempotency-key': idempotencyKey },
        }),
        request(`/api/groups/${group.id}/expenses`, {
          cookie: actor.cookie,
          method: 'POST',
          body: expenseBody,
          headers: { 'idempotency-key': idempotencyKey },
        }),
      ]);

      assert.ok(
        responses.every(response => response.status >= 200 && response.status < 300),
        `相同冪等鍵的回應應成功，實際為 ${responses.map(response => response.status).join(', ')}`,
      );
      const returnedIds = responses
        .map(response => response.data?.id)
        .filter(Boolean);
      assert.ok(returnedIds.length >= 1);
      assert.equal(new Set(returnedIds).size, 1);

      const { rows: [stored] } = await pool.query(
        `SELECT COUNT(*)::int AS count,MIN(id::text) AS id
         FROM expenses
         WHERE group_id=$1 AND title=$2`,
        [group.id, title],
      );
      assert.equal(stored.count, 1);
      assert.equal(returnedIds[0], stored.id);
    });

    await t.test('相同 Idempotency-Key 搭配不同 payload 回傳 409 且不新增資料', async () => {
      const idempotencyKey = `${qaPrefix}_${crypto.randomUUID()}`;
      const title = `${qaPrefix}_IDEMPOTENCY_CONFLICT`;
      const expenseBody = idempotentExpenseBody(title);
      const first = await request(`/api/groups/${group.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        body: expenseBody,
        headers: { 'idempotency-key': idempotencyKey },
      });
      assert.equal(first.status, 201);
      const conflict = await request(`/api/groups/${group.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        body: {
          ...expenseBody,
          title: `${title}_DIFFERENT_PAYLOAD`,
          amount: '2000',
        },
        headers: { 'idempotency-key': idempotencyKey },
      });
      assert.equal(conflict.status, 409);

      const { rows: [afterConflict] } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM expenses
         WHERE group_id=$1
           AND title IN ($2,$3)`,
        [group.id, title, `${title}_DIFFERENT_PAYLOAD`],
      );
      assert.equal(afterConflict.count, 1);
    });

    await t.test('刪除支出後重送舊 Idempotency-Key 不會復活或回傳幽靈資料', async () => {
      const idempotencyKey = `${qaPrefix}_${crypto.randomUUID()}`;
      const title = `${qaPrefix}_DELETED_IDEMPOTENT_EXPENSE`;
      const expenseBody = idempotentExpenseBody(title);
      const created = await request(`/api/groups/${group.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        body: expenseBody,
        headers: { 'idempotency-key': idempotencyKey },
      });
      assert.equal(created.status, 201);

      const deleted = await request(`/api/groups/${group.id}/expenses/${created.data.id}`, {
        cookie: actor.cookie,
        method: 'DELETE',
      });
      assert.equal(deleted.status, 200);

      const replay = await request(`/api/groups/${group.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        body: expenseBody,
        headers: { 'idempotency-key': idempotencyKey },
      });
      assert.equal(replay.status, 410);
      assert.equal(replay.data?.code, 'IDEMPOTENT_RESOURCE_DELETED');

      const { rows: [stored] } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM expenses
         WHERE group_id=$1 AND title=$2`,
        [group.id, title],
      );
      assert.equal(stored.count, 0);
    });

    await t.test('過深的 Idempotency-Key JSON 內容回傳 400 而不是堆疊錯誤', async () => {
      const body = idempotentExpenseBody(`${qaPrefix}_DEEP_JSON`);
      let nested = {};
      body.metadata = nested;
      for (let depth = 0; depth < 40; depth += 1) {
        nested.child = {};
        nested = nested.child;
      }
      const response = await request(`/api/groups/${group.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        body,
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(response.status, 400);
      assert.equal(response.data?.code, 'IDEMPOTENCY_PAYLOAD_TOO_COMPLEX');
    });

    await t.test('群組累計金額超過安全整數時整筆回滾並回傳 422', async () => {
      const largeGroupResponse = rememberGroup(await request('/api/groups', {
        cookie: actor.cookie,
        method: 'POST',
        body: {
          name: `${qaPrefix}_SAFE_INTEGER`,
          description: qaPrefix,
          currency: 'USD',
        },
      }));
      assert.equal(largeGroupResponse.status, 201);
      const largeGroup = largeGroupResponse.data;
      const baseExpense = {
        currency: 'USD',
        payerId: actor.user.id,
        participantIds: [actor.user.id],
        splitMode: 'equal',
      };

      const first = await request(`/api/groups/${largeGroup.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: {
          ...baseExpense,
          title: `${qaPrefix}_SAFE_MAX`,
          amount: '90071992547409.90',
        },
      });
      assert.equal(first.status, 201);

      const overflow = await request(`/api/groups/${largeGroup.id}/expenses`, {
        cookie: actor.cookie,
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: {
          ...baseExpense,
          title: `${qaPrefix}_OVERFLOW`,
          amount: '0.02',
        },
      });
      assert.equal(overflow.status, 422);
      assert.equal(overflow.data?.code, 'LEDGER_GROUP_TOTAL_EXCEEDED');

      const { rows: [stored] } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM expenses
         WHERE group_id=$1`,
        [largeGroup.id],
      );
      assert.equal(stored.count, 1);
    });
  } finally {
    if (actor?.user?.id) {
      const groupIds = [...createdGroupIds];
      await pool.query(
        `DELETE FROM admin_audit_log
         WHERE actor_id=$1
            OR metadata->>'groupId'=ANY($2::text[])`,
        [actor.user.id, groupIds],
      );
      if (groupIds.length) {
        await pool.query(
          'DELETE FROM groups WHERE id=ANY($1::uuid[]) AND owner_id=$2',
          [groupIds, actor.user.id],
        );
      }
      await pool.query(
        `DELETE FROM users
         WHERE id=$1
           AND line_user_id=$2
           AND NOT EXISTS(
             SELECT 1 FROM group_members WHERE user_id=users.id
           )`,
        [actor.user.id, `dev-${qaPrefix}_OWNER`],
      );
    }
    await pool.end();
  }
});
