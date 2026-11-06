type Encoded = null | boolean | number | string | Encoded[] | { [key: string]: Encoded };

// Tag containers so user strings and property names cannot collide with bigint tags.
function encode(value: unknown): Encoded {
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite snapshot value');
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return ['array', ...value.map(encode)];
  if (typeof value === 'object') {
    return ['object', ...Object.keys(value).sort().map(key =>
      [key, encode((value as Record<string, unknown>)[key])])];
  }
  throw new Error('Unsupported snapshot value');
}

function decode(value: Encoded): unknown {
  if (!Array.isArray(value)) return value;
  if (value[0] === 'bigint') return BigInt(value[1] as string);
  if (value[0] === 'array') return value.slice(1).map(decode);
  if (value[0] === 'object') {
    return Object.fromEntries(value.slice(1).map(item => {
      const [key, entry] = item as [string, Encoded];
      return [key, decode(entry)];
    }));
  }
  throw new Error('Unknown snapshot value tag');
}

export function canonical(value: unknown) {
  return JSON.stringify(encode(value));
}

export function readCanonical<T>(value: string): T {
  return decode(JSON.parse(value) as Encoded) as T;
}

// Versioned, portable checksum for replay diagnostics and accidental corruption.
export function checksum(text: string) {
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    low = Math.imul(low ^ text.charCodeAt(i), 0x01000193);
    high = Math.imul(high ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return (low >>> 0).toString(16).padStart(8, '0') + (high >>> 0).toString(16).padStart(8, '0');
}
