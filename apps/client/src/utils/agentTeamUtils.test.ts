import { describe, test, expect } from 'bun:test';

// Test the model label utility
function modelLabel(modelName: string): string {
  if (modelName.includes('haiku')) return 'Haiku';
  if (modelName.includes('sonnet')) return 'Sonnet';
  if (modelName.includes('opus')) return 'Opus';
  return modelName.split('/').pop()?.split('-').slice(0, 2).join('-') ?? modelName;
}

describe('modelLabel', () => {
  test('haiku', () => expect(modelLabel('claude-haiku-4-5')).toBe('Haiku'));
  test('sonnet', () => expect(modelLabel('claude-sonnet-4-5')).toBe('Sonnet'));
  test('opus', () => expect(modelLabel('claude-opus-4-6')).toBe('Opus'));
  test('unknown short', () => expect(modelLabel('some-model-v2')).toBe('some-model'));
});

// Test context window bar class
function contextWindowBarClass(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-[var(--theme-primary)]';
}

describe('contextWindowBarClass', () => {
  test('below 75%', () => expect(contextWindowBarClass(50)).toBe('bg-[var(--theme-primary)]'));
  test('75-90%', () => expect(contextWindowBarClass(80)).toBe('bg-amber-500'));
  test('90%+', () => expect(contextWindowBarClass(95)).toBe('bg-red-500'));
});
