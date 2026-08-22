import {
  PAGE_SEARCH_KEYS,
  readPageSearchSession,
  writePageSearchSession,
  clearPageSearchSession,
  clearAllPageSearchSessions,
} from '../../src/utils/page-search-session.js';

function memoryStore() {
  return {
    data: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
    removeItem(key) {
      delete this.data[key];
    },
  };
}

describe('page search session', () => {
  const defaults = { searchTerm: '', showArchived: false };

  test('remembers criteria per user and page', () => {
    const memory = memoryStore();
    writePageSearchSession(
      PAGE_SEARCH_KEYS.properties,
      7,
      { searchTerm: 'Bellevue', showArchived: true },
      memory
    );
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.properties, 7, defaults, memory)).toEqual({
      searchTerm: 'Bellevue',
      showArchived: true,
    });
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.properties, 8, defaults, memory)).toEqual(defaults);
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.tenants, 7, defaults, memory)).toEqual(defaults);
  });

  test('clearAll removes every finder page key', () => {
    const memory = memoryStore();
    writePageSearchSession(PAGE_SEARCH_KEYS.properties, 7, { searchTerm: 'A' }, memory);
    writePageSearchSession(PAGE_SEARCH_KEYS.listings, 7, { searchTerm: 'B' }, memory);
    clearPageSearchSession(PAGE_SEARCH_KEYS.properties, memory);
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.properties, 7, defaults, memory).searchTerm).toBe('');
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.listings, 7, { searchTerm: '' }, memory).searchTerm).toBe(
      'B'
    );
    clearAllPageSearchSessions(memory);
    expect(readPageSearchSession(PAGE_SEARCH_KEYS.listings, 7, { searchTerm: '' }, memory).searchTerm).toBe(
      ''
    );
  });
});
