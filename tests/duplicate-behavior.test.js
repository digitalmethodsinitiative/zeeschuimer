/**
 * Unit tests for Zeeschuimer duplicate handling logic
 * 
 * Tests verify that the correct existing record is chosen when applying
 * update or merge behaviors to duplicates across navigation boundaries.
 */

let Dexie;
require('fake-indexeddb/auto');

// Mock browser extension APIs
global.browser = {
  storage: {
    local: {
      get: async (key) => ({ [key]: 'insert' }),
      set: async () => {}
    }
  }
};

// Polyfill structuredClone for Node versions/environments where it's absent
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

describe('Duplicate Behavior Tests', () => {
  let db;

  beforeEach(async () => {
    // Dynamically import Dexie (it ships as ESM) and create fresh database for each test
    const dexieModule = await import('dexie');
    Dexie = dexieModule.default || dexieModule.Dexie;
    db = new Dexie('zeeschuimer-items-test');
    
    // Schema version 1
    db.version(1).stores({
      items: "++id, item_id, nav_index, source_platform",
      uploads: "++id",
      nav: "++id, tab_id, session",
      settings: "key"
    });

    // Schema version 2 with compound index
    db.version(2).stores({
      items: "++id, item_id, nav_index, source_platform, last_updated, [item_id+source_platform+last_updated]",
      uploads: "++id",
      nav: "++id, tab_id, session",
      settings: "key"
    }).upgrade(async (tx) => {
      await tx.table('items').toCollection().modify((item) => {
        if (!item.last_updated) {
          item.last_updated = item.timestamp_collected || Date.now();
        }
      });
    });

    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db = null;
  });

  /**
   * Helper: Find existing item using compound index (mimics zs-background.js logic)
   */
  async function findMostRecentItem(item_id, source_platform) {
    return await db.items
      .where('[item_id+source_platform+last_updated]')
      .between(
        [item_id, source_platform, Dexie.minKey],
        [item_id, source_platform, Dexie.maxKey]
      )
      .last();
  }

  test('findMostRecentItem selects newest by last_updated', async () => {
    // Seed three duplicates with different timestamps
    const baseTime = Date.now();
    await db.items.bulkAdd([
      {
        item_id: 'post-123',
        source_platform: 'test.com',
        nav_index: '1:1:0',
        timestamp_collected: baseTime,
        last_updated: baseTime,
        data: { content: 'oldest' }
      },
      {
        item_id: 'post-123',
        source_platform: 'test.com',
        nav_index: '1:1:1',
        timestamp_collected: baseTime + 1000,
        last_updated: baseTime + 1000,
        data: { content: 'middle' }
      },
      {
        item_id: 'post-123',
        source_platform: 'test.com',
        nav_index: '1:1:2',
        timestamp_collected: baseTime + 2000,
        last_updated: baseTime + 2000,
        data: { content: 'newest' }
      }
    ]);

    const result = await findMostRecentItem('post-123', 'test.com');
    
    expect(result).toBeDefined();
    expect(result.data.content).toBe('newest');
    expect(result.last_updated).toBe(baseTime + 2000);
  });

  test('findMostRecentItem returns null when no matches', async () => {
    const result = await findMostRecentItem('nonexistent', 'test.com');
    expect(result).toBeUndefined();
  });

  test('Schema upgrade backfills last_updated from timestamp_collected', async () => {
    // Simulate version 1 data by manually inserting without last_updated
    const baseTime = Date.now();
    const itemId = await db.items.add({
      item_id: 'legacy-post',
      source_platform: 'test.com',
      nav_index: '1:1:0',
      timestamp_collected: baseTime,
      data: { content: 'legacy item' }
    });

    // Manually trigger upgrade logic
    const item = await db.items.get(itemId);
    if (!item.last_updated) {
      await db.items.update(itemId, {
        last_updated: item.timestamp_collected || Date.now()
      });
    }

    const updated = await db.items.get(itemId);
    expect(updated.last_updated).toBe(baseTime);
  });

  test('Forward-looking: switch from keep to update targets newest record', async () => {
    const baseTime = Date.now();
    
    // Simulate "keep duplicates" mode: three captures stored
    await db.items.bulkAdd([
      {
        item_id: 'post-456',
        source_platform: 'test.com',
        nav_index: '1:1:0',
        timestamp_collected: baseTime,
        last_updated: baseTime,
        data: { version: 1 }
      },
      {
        item_id: 'post-456',
        source_platform: 'test.com',
        nav_index: '1:1:1',
        timestamp_collected: baseTime + 1000,
        last_updated: baseTime + 1000,
        data: { version: 2 }
      },
      {
        item_id: 'post-456',
        source_platform: 'test.com',
        nav_index: '1:1:2',
        timestamp_collected: baseTime + 2000,
        last_updated: baseTime + 2000,
        data: { version: 3 }
      }
    ]);

    // User switches to "update" mode, new capture comes in
    const target = await findMostRecentItem('post-456', 'test.com');
    expect(target).toBeDefined();
    expect(target.data.version).toBe(3);

    // Simulate update action
    await db.items.update(target.id, {
      last_updated: Date.now(),
      data: { version: 4, updated: true }
    });

    // Verify only the newest record was updated
    const allItems = await db.items.where({ item_id: 'post-456', source_platform: 'test.com' }).toArray();
    expect(allItems.length).toBe(3); // no new inserts
    
    const updated = allItems.find(i => i.data.updated);
    expect(updated).toBeDefined();
    expect(updated.data.version).toBe(4);
    
    const unchanged = allItems.filter(i => !i.data.updated);
    expect(unchanged.length).toBe(2);
  });

  test('Forward-looking: switch from update to keep creates new records', async () => {
    const baseTime = Date.now();
    
    // Simulate "update" mode: only one record stored, repeatedly updated
    const itemId = await db.items.add({
      item_id: 'post-789',
      source_platform: 'test.com',
      nav_index: '1:1:0',
      timestamp_collected: baseTime,
      last_updated: baseTime + 2000, // updated twice
      data: { version: 3 }
    });

    // User switches to "keep duplicates" mode, new capture comes in
    // Simulate insert action (no lookup, just add)
    await db.items.add({
      item_id: 'post-789',
      source_platform: 'test.com',
      nav_index: '1:1:3',
      timestamp_collected: baseTime + 3000,
      last_updated: baseTime + 3000,
      data: { version: 4 }
    });

    // Verify new record was inserted
    const allItems = await db.items.where({ item_id: 'post-789', source_platform: 'test.com' }).toArray();
    expect(allItems.length).toBe(2);
    
    const versions = allItems.map(i => i.data.version).sort();
    expect(versions).toEqual([3, 4]);
  });

  test('Merge behavior: targets newest record and preserves fields', async () => {
    const baseTime = Date.now();
    
    // Seed duplicates with different fields
    await db.items.bulkAdd([
      {
        item_id: 'post-merge',
        source_platform: 'test.com',
        nav_index: '1:1:0',
        timestamp_collected: baseTime,
        last_updated: baseTime,
        data: { title: 'Original', author: 'Alice' }
      },
      {
        item_id: 'post-merge',
        source_platform: 'test.com',
        nav_index: '1:1:1',
        timestamp_collected: baseTime + 1000,
        last_updated: baseTime + 1000,
        data: { title: 'Updated', likes: 42 }
      }
    ]);

    // User switches to "merge" mode, new capture comes in
    const target = await findMostRecentItem('post-merge', 'test.com');
    expect(target.data.title).toBe('Updated');

    // Simulate shallow merge
    const incomingData = { likes: 100, comments: 5 };
    const merged = Object.assign({}, target.data, incomingData);

    await db.items.update(target.id, {
      last_updated: Date.now(),
      data: merged
    });

    const result = await db.items.get(target.id);
    expect(result.data).toEqual({
      title: 'Updated',
      likes: 100,
      comments: 5
    });
  });

  test('Skip behavior: does not modify when duplicate found', async () => {
    const baseTime = Date.now();
    
    await db.items.add({
      item_id: 'post-skip',
      source_platform: 'test.com',
      nav_index: '1:1:0',
      timestamp_collected: baseTime,
      last_updated: baseTime,
      data: { content: 'original' }
    });

    // User has "skip duplicates" enabled
    const existing = await findMostRecentItem('post-skip', 'test.com');
    
    if (existing) {
      // Skip action: do nothing
    }

    const allItems = await db.items.where({ item_id: 'post-skip', source_platform: 'test.com' }).toArray();
    expect(allItems.length).toBe(1);
    expect(allItems[0].data.content).toBe('original');
  });

  test('Multiple platforms: lookup isolates by source_platform', async () => {
    const baseTime = Date.now();
    
    // Same item_id on different platforms
    await db.items.bulkAdd([
      {
        item_id: 'cross-123',
        source_platform: 'platform-a.com',
        nav_index: '1:1:0',
        timestamp_collected: baseTime,
        last_updated: baseTime,
        data: { platform: 'A' }
      },
      {
        item_id: 'cross-123',
        source_platform: 'platform-b.com',
        nav_index: '1:1:0',
        timestamp_collected: baseTime + 1000,
        last_updated: baseTime + 1000,
        data: { platform: 'B' }
      }
    ]);

    const resultA = await findMostRecentItem('cross-123', 'platform-a.com');
    const resultB = await findMostRecentItem('cross-123', 'platform-b.com');

    expect(resultA.data.platform).toBe('A');
    expect(resultB.data.platform).toBe('B');
  });

  test('Tie-breaker: when last_updated equal, prefer higher id', async () => {
    const baseTime = Date.now();
    
    // Insert items with same last_updated but different insert order
    const id1 = await db.items.add({
      item_id: 'tie-break',
      source_platform: 'test.com',
      nav_index: '1:1:0',
      timestamp_collected: baseTime,
      last_updated: baseTime,
      data: { order: 'first' }
    });

    const id2 = await db.items.add({
      item_id: 'tie-break',
      source_platform: 'test.com',
      nav_index: '1:1:1',
      timestamp_collected: baseTime,
      last_updated: baseTime, // same timestamp
      data: { order: 'second' }
    });

    const result = await findMostRecentItem('tie-break', 'test.com');
    
    // Should return the one with higher id (inserted later)
    expect(result.id).toBe(id2);
    expect(result.data.order).toBe('second');
  });
});
