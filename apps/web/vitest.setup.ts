import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Register jest-dom matchers on this file's `expect` (the same instance the tests use).
expect.extend(matchers);
afterEach(() => cleanup());
