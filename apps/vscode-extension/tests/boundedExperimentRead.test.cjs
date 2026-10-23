const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { REAL_EXPERIMENT_BYTES } = require('../dist/realExperiments');
const { readBoundedExperimentFile } = require('../dist/boundedExperimentRead');

test('actual regular files are read exactly without mutation; non-files and oversize fail generically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-bounded-'));
  try {
    const file = path.join(dir, 'snapshot.json');
    const bytes = Buffer.from('模型 🚀 exact');
    fs.writeFileSync(file, bytes);
    assert.deepEqual(await readBoundedExperimentFile(file), bytes);
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.symlinkSync(file, path.join(dir, 'link'));
    const large = path.join(dir, 'large');
    const fd = fs.openSync(large, 'w');
    fs.ftruncateSync(fd, REAL_EXPERIMENT_BYTES + 1);
    fs.closeSync(fd);
    for (const invalid of [
      dir,
      large,
      path.join(dir, 'link'),
      path.join(dir, 'missing'),
      '',
      null,
    ])
      await assert.rejects(readBoundedExperimentFile(invalid), {
        message: 'invalid_snapshot_file',
      });
    fs.writeFileSync(file, Buffer.alloc(REAL_EXPERIMENT_BYTES, 42));
    const max = await readBoundedExperimentFile(file);
    assert.equal(max.byteLength, REAL_EXPERIMENT_BYTES);
    assert.equal(max[max.length - 1], 42);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function fakeReader(handle, openFailure = false) {
  const load = Module._load;
  const modulePath = require.resolve('../dist/boundedExperimentRead');
  delete require.cache[modulePath];
  Module._load = function (name, ...args) {
    if (name === 'node:fs/promises')
      return {
        open: async () => {
          if (openFailure) throw new Error('secret/path/body');
          return handle;
        },
      };
    return load.call(this, name, ...args);
  };
  try {
    return require(modulePath).readBoundedExperimentFile;
  } finally {
    Module._load = load;
    delete require.cache[modulePath];
  }
}
test('growth after fstat is bounded at cap+sentinel using at most 64KiB reads and closes on failure', async () => {
  let readBytes = 0,
    closes = 0,
    calls = 0;
  const read = fakeReader({
    stat: async () => ({ isFile: () => true, size: 1 }),
    read: async (buffer, offset, length) => {
      calls++;
      assert.ok(length <= 64 * 1024);
      assert.equal(buffer.length, length);
      assert.equal(offset, 0);
      readBytes += length;
      return { bytesRead: length };
    },
    close: async () => {
      closes++;
    },
  });
  await assert.rejects(read('/not-used'), { message: 'invalid_snapshot_file' });
  assert.equal(readBytes, REAL_EXPERIMENT_BYTES + 1);
  assert.equal(calls, REAL_EXPERIMENT_BYTES / (64 * 1024) + 1);
  assert.equal(closes, 1);
});
test('fstat failures reject before read; read/open/close errors expose no details', async () => {
  for (const kind of [
    'directory',
    'oversize',
    'negative',
    'unsafe',
    'stat',
    'read',
    'close',
    'open',
  ]) {
    let reads = 0,
      closes = 0;
    const read = fakeReader(
      {
        stat: async () => {
          if (kind === 'stat') throw new Error('sensitive');
          return {
            isFile: () => kind !== 'directory',
            size:
              kind === 'oversize'
                ? REAL_EXPERIMENT_BYTES + 1
                : kind === 'negative'
                  ? -1
                  : kind === 'unsafe'
                    ? NaN
                    : 0,
          };
        },
        read: async () => {
          reads++;
          if (kind === 'read') throw new Error('sensitive');
          return { bytesRead: 0 };
        },
        close: async () => {
          closes++;
          if (kind === 'close') throw new Error('sensitive');
        },
      },
      kind === 'open',
    );
    await assert.rejects(read('/secret-path'), {
      message: 'invalid_snapshot_file',
    });
    if (
      ['directory', 'oversize', 'negative', 'unsafe', 'stat', 'open'].includes(
        kind,
      )
    )
      assert.equal(reads, 0);
    assert.ok(closes >= (kind === 'open' ? 0 : 1));
  }
});

test('one-byte short reads fill shared chunks with bounded backing storage and exact output', async () => {
  for (const size of [128, 2 * 64 * 1024 + 7]) {
    let position = 0,
      closes = 0,
      allocations = 0,
      allocatedBytes = 0;
    const buffers = new Set();
    const read = fakeReader({
      stat: async () => ({ isFile: () => true, size: 1 }),
      read: async (buffer, offset, length) => {
        buffers.add(buffer.buffer);
        assert.ok(length > 0 && length <= 64 * 1024);
        assert.equal(offset + length, buffer.length);
        if (position === size) return { bytesRead: 0 };
        buffer[offset] = position++ % 251;
        return { bytesRead: 1 };
      },
      close: async () => {
        closes++;
      },
    });
    const alloc = Buffer.alloc,
      concat = Buffer.concat;
    let retainedBytes = 0,
      retainedChunks = 0;
    Buffer.alloc = (length, ...args) => {
      allocations++;
      allocatedBytes += length;
      return alloc(length, ...args);
    };
    Buffer.concat = (chunks, ...args) => {
      retainedChunks = chunks.length;
      retainedBytes = chunks.reduce(
        (sum, chunk) => sum + chunk.buffer.byteLength,
        0,
      );
      return concat(chunks, ...args);
    };
    let bytes;
    try {
      bytes = await read('/mock-only');
    } finally {
      Buffer.alloc = alloc;
      Buffer.concat = concat;
    }
    assert.equal(bytes.length, size);
    for (let i = 0; i < size; i++) assert.equal(bytes[i], i % 251);
    const expectedChunks = Math.ceil(size / (64 * 1024));
    assert.equal(allocations, expectedChunks);
    assert.equal(buffers.size, expectedChunks);
    assert.equal(retainedChunks, expectedChunks);
    assert.equal(retainedBytes, expectedChunks * 64 * 1024);
    assert.equal(allocatedBytes, expectedChunks * 64 * 1024);
    assert.equal(closes, 1);
  }
});

test('fragmented growth permits exact cap and rejects sentinel without concatenation', async () => {
  for (const oversize of [false, true]) {
    let position = 0,
      closes = 0,
      concatenations = 0;
    const buffers = new Set();
    const size = REAL_EXPERIMENT_BYTES + Number(oversize);
    const read = fakeReader({
      stat: async () => ({ isFile: () => true, size: 0 }),
      read: async (buffer, offset, length) => {
        buffers.add(buffer.buffer);
        const bytesRead = Math.min(997, length, size - position);
        buffer.fill(42, offset, offset + bytesRead);
        position += bytesRead;
        return { bytesRead };
      },
      close: async () => {
        closes++;
      },
    });
    const concat = Buffer.concat;
    Buffer.concat = (...args) => {
      concatenations++;
      return concat(...args);
    };
    try {
      if (oversize)
        await assert.rejects(read('/mock-only'), {
          message: 'invalid_snapshot_file',
        });
      else {
        const bytes = await read('/mock-only');
        assert.equal(bytes.length, REAL_EXPERIMENT_BYTES);
        assert.ok(bytes.every((value) => value === 42));
      }
    } finally {
      Buffer.concat = concat;
    }
    assert.equal(position, size);
    assert.equal(buffers.size, REAL_EXPERIMENT_BYTES / (64 * 1024) + 1);
    assert.equal(concatenations, Number(!oversize));
    assert.equal(closes, 1);
  }
});

test('failure and invalid byte counts after a short read close generically', async () => {
  for (const invalid of ['throw', -1, 0.5, NaN, 64 * 1024]) {
    let calls = 0,
      closes = 0;
    const read = fakeReader({
      stat: async () => ({ isFile: () => true, size: 2 }),
      read: async (buffer, offset, length) => {
        if (calls++ === 0) {
          buffer[offset] = 42;
          return { bytesRead: 1 };
        }
        assert.equal(offset, 1);
        assert.equal(length, 64 * 1024 - 1);
        if (invalid === 'throw') throw new Error('secret path');
        return { bytesRead: invalid };
      },
      close: async () => {
        closes++;
      },
    });
    await assert.rejects(read('/mock-only'), {
      message: 'invalid_snapshot_file',
    });
    assert.equal(closes, 1);
  }
});
